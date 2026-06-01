import { simpleGit, type SimpleGit } from 'simple-git';
import { createHash } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import type {
	BranchInfo,
	ChangedFile,
	CommitFileSelection,
	CreateRepoOptions,
	DiffContext,
	DiffData,
	FileStatus,
	GitIdentity,
	RepoInfo
} from './types.js';
import { imageMimeForPath } from './media.js';
import { getGitignore, getLicense } from './repo-templates.js';

const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Images are embedded as base64 `data:` URLs and shipped whole over IPC, so the
// cap is higher than the text cap (images are routinely a few MB) but still
// bounded — past this we leave the side unrendered rather than balloon memory.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function repoIdFromPath(p: string): string {
	return createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 12);
}

export async function isGitRepo(dirPath: string): Promise<boolean> {
	try {
		const git = simpleGit(dirPath);
		return await git.checkIsRepo();
	} catch {
		return false;
	}
}

// Directories we never descend into while scanning a folder for repos: package
// caches, build output, and other VCS metadata. They never contain a repo we
// want to surface and can hold tens of thousands of files.
const SCAN_IGNORE_DIRS = new Set([
	'node_modules',
	'.git',
	'.svn',
	'.hg',
	'dist',
	'build',
	'out',
	'target',
	'.next',
	'.turbo',
	'.cache',
	'.venv',
	'venv',
	'__pycache__',
	'vendor',
	'Pods'
]);

// How deep below the chosen folder we'll look. Repos are normally checked out a
// level or two down (e.g. ~/code/<repo> or ~/code/<org>/<repo>); a bound keeps a
// stray deep tree from turning the scan into a full-disk walk.
const MAX_SCAN_DEPTH = 4;

// Recursively find git repositories under `rootPath`. A directory containing a
// `.git` entry is treated as a repo and is not descended into (so nested repos
// inside a checkout aren't double-counted). Returns absolute repo paths.
export async function scanForRepos(rootPath: string): Promise<string[]> {
	const found: string[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		// `.git` is a directory in a normal checkout and a file in a worktree or
		// submodule — either marks `dir` as a repository.
		let isRepo = false;
		try {
			await fs.stat(path.join(dir, '.git'));
			isRepo = true;
		} catch {
			// No `.git` here — keep descending.
		}
		if (isRepo) {
			found.push(dir);
			return;
		}
		if (depth >= MAX_SCAN_DEPTH) return;

		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return; // Unreadable directory (permissions, etc.) — skip it.
		}

		const subdirs = entries.filter(
			(e) => e.isDirectory() && !e.name.startsWith('.') && !SCAN_IGNORE_DIRS.has(e.name)
		);
		await Promise.all(subdirs.map((e) => walk(path.join(dir, e.name), depth + 1)));
	}

	await walk(path.resolve(rootPath), 0);
	return found;
}

// Names we're willing to treat as a repo icon, ranked best → worst. A real
// favicon beats a generic logo; `app-icon`/`AppIcon` cover macOS bundles.
const ICON_BASE_PRIORITY: Record<string, number> = {
	favicon: 0,
	icon: 1,
	'app-icon': 2,
	appicon: 2,
	logo: 3
};
const ICON_EXT_PRIORITY: Record<string, number> = {
	svg: 0,
	png: 1,
	ico: 2
};
// Directory names we always skip — too noisy, too big, or vendored output.
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.svn',
	'.hg',
	'.next',
	'.nuxt',
	'.svelte-kit',
	'.turbo',
	'.vercel',
	'.cache',
	'.parcel-cache',
	'.angular',
	'dist',
	'out',
	'build',
	'target',
	'coverage',
	'tmp',
	'temp',
	'.idea',
	'.vscode'
]);

// Directories whose icons rarely represent the repo's brand. We still scan
// into them (so single-example repos resolve), but apply a large score
// penalty so a favicon in `apps/docs/` beats one in `examples/svelte/`.
const NON_CANONICAL_SEGMENTS = new Set([
	'examples',
	'example',
	'demo',
	'demos',
	'sample',
	'samples',
	'fixture',
	'fixtures',
	'test',
	'tests',
	'__tests__',
	'e2e',
	'playground',
	'sandbox',
	'storybook',
	'.storybook'
]);

// electron-builder config filenames. Any of these at a directory marks it as
// an Electron project root; `package.json` deps / a `build` key also count
// (see electronIconIn).
const ELECTRON_CONFIG_FILES = new Set([
	'electron-builder.yml',
	'electron-builder.yaml',
	'electron-builder.json',
	'electron-builder.json5',
	'electron-builder.js',
	'electron-builder.cjs',
	'electron-builder.mjs',
	'electron-builder.ts'
]);

// Electron apps have no favicon; their brand icon is whatever electron-builder
// packages from its buildResources dir (default `build/`) as icon.png/.ico.
// That dir is in SKIP_DIRS — build output for most projects — so the generic
// scan never reaches it. Detect an Electron project at `dir` and return its
// build icon if present. Bounded to one package.json read + a few stat()s.
async function electronIconIn(dir: string, entries: Dirent[]): Promise<string | undefined> {
	let isElectron = entries.some(
		(e) => e.isFile() && ELECTRON_CONFIG_FILES.has(e.name.toLowerCase())
	);
	let buildResources = 'build';
	if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
		try {
			const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			if (deps.electron || deps['electron-builder'] || pkg.build) {
				isElectron = true;
			}
			const br = pkg.build?.directories?.buildResources;
			if (typeof br === 'string' && br) buildResources = br;
		} catch {
			// unreadable / non-JSON package.json — rely on config-file detection
		}
	}
	if (!isElectron) return undefined;
	// Prefer png/ico (renderable in an <img>); .icns isn't, so skip it. Covers
	// the buildResources icon and the linux `icons/` dir convention.
	for (const rel of [
		`${buildResources}/icon.png`,
		`${buildResources}/icon.ico`,
		`${buildResources}/icons/512x512.png`
	]) {
		const candidate = path.join(dir, rel);
		try {
			const st = await fs.stat(candidate);
			if (st.isFile() && st.size > 0 && st.size <= 256 * 1024) return candidate;
		} catch {
			// not present — try the next
		}
	}
	return undefined;
}

// Walk the repo up to MAX_DEPTH looking for the best-ranked icon. Bounded
// because monorepos can have thousands of subdirs and we don't want to stall
// the picker. A "best so far" tracker lets us short-circuit when we hit the
// top-priority candidate (favicon.svg).
async function findRepoIcon(repoPath: string): Promise<string | undefined> {
	const MAX_DEPTH = 5;
	let bestPath: string | undefined;
	let bestScore = Number.POSITIVE_INFINITY;

	async function visit(dir: string, depth: number, nonCanonical: boolean): Promise<void> {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		// An Electron app's build icon (build/icon.png) sits in a SKIP_DIRS dir the
		// loop below won't descend into — check for it explicitly and score it as
		// authoritatively as a favicon (basePriority 0).
		const elIcon = await electronIconIn(dir, entries);
		if (elIcon) {
			const ext = path.extname(elIcon).slice(1).toLowerCase();
			const score = (ICON_EXT_PRIORITY[ext] ?? 1) * 10 + depth + (nonCanonical ? 500 : 0);
			if (score < bestScore) {
				bestScore = score;
				bestPath = elIcon;
			}
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.') && entry.name !== '.well-known') {
				// skip dotfiles/dotdirs except a few we explicitly allow above
				if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
				if (entry.isDirectory()) continue;
				// dotfile — not an icon
				continue;
			}
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				if (depth >= MAX_DEPTH) continue;
				const childNonCanonical =
					nonCanonical || NON_CANONICAL_SEGMENTS.has(entry.name.toLowerCase());
				await visit(path.join(dir, entry.name), depth + 1, childNonCanonical);
				if (bestScore === 0) return;
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).slice(1).toLowerCase();
				const extPriority = ICON_EXT_PRIORITY[ext];
				if (extPriority === undefined) continue;
				const stem = entry.name.slice(0, entry.name.length - ext.length - 1).toLowerCase();
				const basePriority = ICON_BASE_PRIORITY[stem];
				if (basePriority === undefined) continue;
				// Depth penalty so top-level files beat deeply nested ones at the
				// same base/ext rank, but a `favicon.svg` 4 levels deep still wins
				// over a `logo.png` at the root. Non-canonical paths (examples/,
				// tests/, fixtures/) take a large penalty so the brand favicon
				// outranks starter-template icons.
				const score = basePriority * 100 + extPriority * 10 + depth + (nonCanonical ? 500 : 0);
				if (score < bestScore) {
					bestScore = score;
					bestPath = path.join(dir, entry.name);
					if (bestScore === 0) return;
				}
			}
		}
	}

	await visit(repoPath, 0, false);
	if (!bestPath) return undefined;
	try {
		const buf = await fs.readFile(bestPath);
		if (buf.byteLength === 0 || buf.byteLength > 256 * 1024) return undefined;
		const ext = path.extname(bestPath).slice(1).toLowerCase();
		const mime =
			ext === 'svg'
				? 'image/svg+xml'
				: ext === 'png'
					? 'image/png'
					: ext === 'ico'
						? 'image/x-icon'
						: `image/${ext}`;
		return `data:${mime};base64,${buf.toString('base64')}`;
	} catch {
		return undefined;
	}
}

// Maps each SSH `Host` alias in ~/.ssh/config to its real `HostName`, so a
// remote like `git@github.com-work:owner/repo` (a common per-account alias) can
// be recognized as GitHub. Read once and cached for the process lifetime.
let sshHostMapCache: Map<string, string> | null = null;
async function sshHostMap(): Promise<Map<string, string>> {
	if (sshHostMapCache) return sshHostMapCache;
	const map = new Map<string, string>();
	try {
		const cfg = await fs.readFile(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
		let aliases: string[] = [];
		for (const raw of cfg.split(/\r?\n/)) {
			const line = raw.trim();
			if (!line || line.startsWith('#')) continue;
			const sep = line.search(/\s|=/);
			if (sep === -1) continue;
			const key = line.slice(0, sep).toLowerCase();
			const value = line
				.slice(sep + 1)
				.replace(/^[=\s]+/, '')
				.trim();
			if (key === 'host') aliases = value.split(/\s+/);
			else if (key === 'hostname') for (const a of aliases) map.set(a, value);
		}
	} catch {
		// No ssh config (or unreadable) — nothing to resolve.
	}
	sshHostMapCache = map;
	return map;
}

// Recognizes GitHub remotes across https, scp-like ssh (git@host:owner/repo)
// and ssh:// forms. SSH host aliases are resolved via ~/.ssh/config, and the
// repo segment may contain dots (e.g. "repo.js").
async function parseGithubFromUrl(
	url: string
): Promise<{ owner: string; repo: string } | undefined> {
	let host: string | undefined;
	let rest: string | undefined;
	if (!url.includes('://')) {
		const m = url.match(/^[^@]+@([^:/]+):(.+)$/); // git@host:owner/repo
		if (m) {
			host = m[1];
			rest = m[2];
		}
	}
	if (!host) {
		// scheme://[user@]host[:port]/owner/repo
		const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/i);
		if (m) {
			host = m[1];
			rest = m[2];
		}
	}
	if (!host || !rest) return undefined;

	let realHost = host;
	if (realHost.toLowerCase() !== 'github.com') {
		realHost = (await sshHostMap()).get(host) ?? host;
	}
	if (realHost.toLowerCase() !== 'github.com') return undefined;

	const m = rest
		.replace(/\.git$/i, '')
		.replace(/\/+$/, '')
		.match(/^([^/]+)\/([^/]+)$/);
	if (!m) return undefined;
	return { owner: m[1], repo: m[2] };
}

export async function buildRepoInfo(repoPath: string): Promise<RepoInfo> {
	const git = simpleGit(repoPath);
	const id = repoIdFromPath(repoPath);
	const name = path.basename(repoPath);
	let remoteUrl: string | undefined;
	let githubOwner: string | undefined;
	let githubRepo: string | undefined;
	try {
		const remotes = await git.getRemotes(true);
		const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
		if (origin?.refs.fetch) {
			remoteUrl = origin.refs.fetch;
			const gh = await parseGithubFromUrl(remoteUrl);
			if (gh) {
				githubOwner = gh.owner;
				githubRepo = gh.repo;
			}
			console.log(
				`[repo] buildRepoInfo "${name}" remote=${origin.name} url=${remoteUrl} ` +
					`→ parsed ${gh ? `${gh.owner}/${gh.repo}` : '(not a github.com URL)'}`
			);
		} else {
			console.log(
				`[repo] buildRepoInfo "${name}" has no usable remote ` +
					`(remotes: ${remotes.map((r) => r.name).join(', ') || 'none'})`
			);
		}
	} catch (err) {
		console.error(`[repo] buildRepoInfo "${name}" failed to read remotes:`, err);
	}
	const defaultBranch = await detectDefaultBranch(git);
	const iconDataUrl = await findRepoIcon(repoPath);
	const description = await readRepoDescription(repoPath);
	return {
		id,
		path: path.resolve(repoPath),
		name,
		iconDataUrl,
		remoteUrl,
		githubOwner,
		githubRepo,
		defaultBranch,
		description,
		lastOpenedAt: Date.now()
	};
}

// Read `.git/description` (which the create-repo form seeds), ignoring git's
// default placeholder and any empty value. Returns undefined when there's no
// meaningful description (or `.git` isn't a plain directory, e.g. a worktree).
async function readRepoDescription(repoPath: string): Promise<string | undefined> {
	try {
		const raw = (await fs.readFile(path.join(repoPath, '.git', 'description'), 'utf8')).trim();
		if (!raw || raw.startsWith('Unnamed repository')) return undefined;
		return raw;
	} catch {
		return undefined;
	}
}

export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
	const git = simpleGit(repoPath);
	// One `for-each-ref` call gives us the name, ref kind, and committer epoch
	// for every branch — much cheaper than `branch -vv` + per-branch date probes
	// and lets the picker show GitHub Desktop-style relative timestamps.
	const [currentRaw, raw] = await Promise.all([
		git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
		git.raw([
			'for-each-ref',
			'--format=%(refname:short)\t%(committerdate:unix)\t%(upstream:short)',
			'refs/heads'
		])
	]);
	const current = currentRaw.trim();
	const branches: BranchInfo[] = [];
	for (const line of raw.split('\n').filter(Boolean)) {
		const [name, tsRaw, upstreamRaw] = line.split('\t');
		if (!name) continue;
		const ts = Number(tsRaw);
		branches.push({
			name,
			current: name === current,
			// `%(upstream:short)` is the configured tracking branch (e.g.
			// "origin/feat") — its presence is how we tell a branch also lives on a
			// remote. Empty when the branch tracks nothing.
			upstream: upstreamRaw ? upstreamRaw : undefined,
			isRemote: false,
			lastCommitAt: Number.isFinite(ts) && ts > 0 ? ts * 1000 : undefined
		});
	}
	branches.sort((a, b) => {
		if (a.current !== b.current) return a.current ? -1 : 1;
		if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
		// Most recently updated first — matches GitHub Desktop's branch list.
		const at = a.lastCommitAt ?? 0;
		const bt = b.lastCommitAt ?? 0;
		if (at !== bt) return bt - at;
		return a.name.localeCompare(b.name);
	});
	return branches;
}

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
	const git = simpleGit(repoPath);
	try {
		const status = await git.status();
		return status.current ?? null;
	} catch {
		return null;
	}
}

export async function checkout(repoPath: string, branch: string): Promise<void> {
	const git = simpleGit(repoPath);
	await git.checkout(branch);
}

export async function isWorkingTreeDirty(repoPath: string): Promise<boolean> {
	try {
		const status = await simpleGit(repoPath).status();
		return !status.isClean();
	} catch {
		return false;
	}
}

export interface CreateBranchResult {
	ok: boolean;
	error?: string;
}

export interface DeleteBranchResult {
	ok: boolean;
	error?: string;
}

// Create a new branch off of `base` (defaults to current HEAD). When
// `checkout` is true we use `checkout -b` so the working tree follows along
// (GitHub Desktop's "Bring my changes" path); otherwise the branch is created
// without switching, leaving uncommitted changes on the current branch.
export async function createBranch(
	repoPath: string,
	name: string,
	opts: { base?: string; checkout: boolean }
): Promise<CreateBranchResult> {
	const trimmed = name.trim();
	if (!trimmed) return { ok: false, error: 'Branch name is required.' };
	const git = simpleGit(repoPath);
	try {
		if (opts.checkout) {
			const args = ['checkout', '-b', trimmed];
			if (opts.base) args.push(opts.base);
			await git.raw(args);
		} else {
			const args = ['branch', trimmed];
			if (opts.base) args.push(opts.base);
			await git.raw(args);
		}
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// Delete a local branch (force, so we don't fail on "not fully merged" — the
// UI already gates this behind an explicit confirmation). When `deleteRemote`
// is set and the branch has a tracking ref, also delete it on the remote.
// `upstream` is the short tracking ref (e.g. "origin/feat"); we split off the
// remote name (which can't contain a slash) to get the remote-side ref.
export async function deleteBranch(
	repoPath: string,
	name: string,
	opts: { deleteRemote: boolean; upstream?: string }
): Promise<DeleteBranchResult> {
	const trimmed = name.trim();
	if (!trimmed) return { ok: false, error: 'Branch name is required.' };
	const git = simpleGit(repoPath);
	try {
		await git.raw(['branch', '-D', trimmed]);
		if (opts.deleteRemote && opts.upstream) {
			const slash = opts.upstream.indexOf('/');
			if (slash > 0) {
				const remote = opts.upstream.slice(0, slash);
				const ref = opts.upstream.slice(slash + 1);
				await git.push([remote, '--delete', ref]);
			}
		}
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

function mapStatus(x: string, y: string): FileStatus {
	const c = (x + y).trim();
	if (c.includes('?')) return 'untracked';
	if (x === 'R' || y === 'R') return 'renamed';
	if (x === 'C' || y === 'C') return 'copied';
	if (x === 'A' || y === 'A') return 'added';
	if (x === 'D' || y === 'D') return 'deleted';
	if (x === 'T' || y === 'T') return 'type-change';
	return 'modified';
}

async function refsForContext(
	git: SimpleGit,
	ctx: DiffContext
): Promise<{ base?: string; head?: string; workingTree: boolean }> {
	switch (ctx.kind) {
		case 'workingTree':
			return { workingTree: true };
		case 'branch':
			return { base: ctx.base, head: ctx.head, workingTree: false };
		case 'pr':
			return {
				base: `pr/${ctx.prNumber}/base`,
				head: `pr/${ctx.prNumber}/head`,
				workingTree: false
			};
		case 'session':
			// Sessions are frozen snapshots served from disk by the IPC layer; they
			// never reach git-service. Guard the invariant rather than guess a ref.
			throw new Error('session context is not backed by git');
	}
	void git;
}

// Whether `ref` resolves to a commit. A freshly-created repo (or any branch
// with no commits yet) has no resolvable refs, so a base...head diff against it
// throws "unknown revision"; callers use this to treat that as "no changes".
async function revExists(git: SimpleGit, ref: string): Promise<boolean> {
	try {
		await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
		return true;
	} catch {
		return false;
	}
}

export async function listChangedFiles(repoPath: string, ctx: DiffContext): Promise<ChangedFile[]> {
	const git = simpleGit(repoPath);
	const refs = await refsForContext(git, ctx);
	const files: ChangedFile[] = [];

	if (refs.workingTree) {
		// One git status + one git diff --numstat HEAD covers every tracked
		// change (staged + unstaged). Calling numstat per-file was the dominant
		// cost: each git subprocess spawn is ~30-100ms on macOS, so a repo with
		// 30 changed files paid 1-3s just for numstats. Untracked files aren't
		// included in `diff HEAD`; we count those from disk in parallel below.
		const [status, numstatRaw] = await Promise.all([
			git.status(),
			git.raw(['diff', '--numstat', 'HEAD']).catch(() => '')
		]);
		const numstatMap = parseNumstat(numstatRaw);
		const untrackedReadTasks: Array<{ index: number; filePath: string }> = [];

		for (const f of status.files) {
			const fullStatus = mapStatus(f.index, f.working_dir);
			let oldPath: string | undefined;
			let p = f.path;
			const renameMatch = f.path.match(/^(.+) -> (.+)$/);
			if (renameMatch) {
				oldPath = renameMatch[1];
				p = renameMatch[2];
			}
			const ns = numstatMap.get(p) ?? {
				additions: 0,
				deletions: 0,
				binary: false
			};
			files.push({
				path: p,
				oldPath,
				status: fullStatus,
				additions: ns.additions,
				deletions: ns.deletions,
				isBinary: ns.binary
			});
			// numstat returns nothing for untracked files (git doesn't track them)
			// and sometimes for staged adds depending on what's in the index.
			// Queue a disk read so the user sees a real line count.
			if (
				!ns.binary &&
				ns.additions === 0 &&
				ns.deletions === 0 &&
				(fullStatus === 'untracked' || fullStatus === 'added')
			) {
				untrackedReadTasks.push({ index: files.length - 1, filePath: p });
			}
		}

		if (untrackedReadTasks.length > 0) {
			await Promise.all(
				untrackedReadTasks.map(async ({ index, filePath }) => {
					const counted = await countWorkingLines(repoPath, filePath);
					if (counted) {
						files[index] = {
							...files[index],
							additions: counted.additions,
							isBinary: counted.binary
						};
					}
				})
			);
		}
		return files;
	}

	if (refs.base && refs.head) {
		// Bail out cleanly when either side doesn't exist yet (e.g. a repo with no
		// commits, where `main...main` would throw) — there are simply no changes.
		if (!(await revExists(git, refs.base)) || !(await revExists(git, refs.head))) {
			return files;
		}
		const raw = await git.raw([
			'diff',
			'--name-status',
			'--find-renames',
			`${refs.base}...${refs.head}`
		]);
		const numstatRaw = await git.raw(['diff', '--numstat', `${refs.base}...${refs.head}`]);
		const numstatMap = parseNumstat(numstatRaw);

		for (const line of raw.split('\n').filter(Boolean)) {
			const parts = line.split('\t');
			const code = parts[0];
			let status: FileStatus = 'modified';
			let oldPath: string | undefined;
			let p = parts[1];
			if (code.startsWith('A')) status = 'added';
			else if (code.startsWith('D')) status = 'deleted';
			else if (code.startsWith('M')) status = 'modified';
			else if (code.startsWith('R')) {
				status = 'renamed';
				oldPath = parts[1];
				p = parts[2];
			} else if (code.startsWith('C')) {
				status = 'copied';
				oldPath = parts[1];
				p = parts[2];
			} else if (code.startsWith('T')) status = 'type-change';
			const ns = numstatMap.get(p) ?? {
				additions: 0,
				deletions: 0,
				binary: false
			};
			files.push({
				path: p,
				oldPath,
				status,
				additions: ns.additions,
				deletions: ns.deletions,
				isBinary: ns.binary
			});
		}
	}
	return files;
}

interface NumstatRow {
	additions: number;
	deletions: number;
	binary: boolean;
}

function parseNumstat(raw: string): Map<string, NumstatRow> {
	const map = new Map<string, NumstatRow>();
	for (const line of raw.split('\n').filter(Boolean)) {
		const [a, d, ...pathParts] = line.split('\t');
		const p = pathParts.join('\t');
		const binary = a === '-' && d === '-';
		map.set(p, {
			additions: binary ? 0 : Number(a) || 0,
			deletions: binary ? 0 : Number(d) || 0,
			binary
		});
	}
	return map;
}

async function safeNumstat(
	git: SimpleGit,
	base: string | undefined,
	head: string | undefined,
	filePath: string
): Promise<NumstatRow> {
	try {
		const args: string[] = ['diff', '--numstat'];
		if (base && head) args.push(`${base}...${head}`);
		args.push('--', filePath);
		const raw = await git.raw(args);
		const row = parseNumstat(raw).get(filePath);
		return row ?? { additions: 0, deletions: 0, binary: false };
	} catch {
		return { additions: 0, deletions: 0, binary: false };
	}
}

// Raw newline count of a working-copy file, plus a quick null-byte probe to
// flag binaries. Used as a fallback when git numstat can't produce a count
// (untracked files, fresh adds).
async function countWorkingLines(
	repoPath: string,
	filePath: string
): Promise<{ additions: number; binary: boolean } | null> {
	try {
		const abs = path.join(repoPath, filePath);
		const stat = await fs.stat(abs);
		if (!stat.isFile()) return null;
		if (stat.size === 0) return { additions: 0, binary: false };
		if (stat.size > MAX_FILE_BYTES) return { additions: 0, binary: false };
		const buf = await fs.readFile(abs);
		const probeEnd = Math.min(buf.length, 8192);
		for (let i = 0; i < probeEnd; i++) {
			if (buf[i] === 0) return { additions: 0, binary: true };
		}
		let lines = 0;
		for (let i = 0; i < buf.length; i++) {
			if (buf[i] === 0x0a) lines++;
		}
		if (buf[buf.length - 1] !== 0x0a) lines++;
		return { additions: lines, binary: false };
	} catch {
		return null;
	}
}

async function showFile(git: SimpleGit, ref: string, filePath: string): Promise<string> {
	try {
		return await git.show([`${ref}:${filePath}`]);
	} catch {
		return '';
	}
}

async function readWorkingFile(repoPath: string, filePath: string): Promise<string> {
	try {
		const buf = await fs.readFile(path.join(repoPath, filePath));
		if (buf.byteLength > MAX_FILE_BYTES) return '';
		return buf.toString('utf8');
	} catch {
		return '';
	}
}

// Raw bytes of `ref:filePath` straight from git's object store, preserving the
// binary content (simple-git's `.show()` decodes to a lossy UTF-8 string, which
// mangles images). Returns null when the path doesn't exist at that ref or the
// blob exceeds the image cap.
async function showFileBuffer(
	repoPath: string,
	ref: string,
	filePath: string
): Promise<Buffer | null> {
	try {
		const { stdout } = await execFileAsync('git', ['show', `${ref}:${filePath}`], {
			cwd: repoPath,
			encoding: 'buffer',
			maxBuffer: MAX_IMAGE_BYTES
		});
		return stdout;
	} catch {
		return null;
	}
}

// Raw bytes of a working-copy file, or null when it's missing or over the cap.
async function readWorkingBuffer(repoPath: string, filePath: string): Promise<Buffer | null> {
	try {
		const buf = await fs.readFile(path.join(repoPath, filePath));
		if (buf.byteLength > MAX_IMAGE_BYTES) return null;
		return buf;
	} catch {
		return null;
	}
}

function bufferToDataUrl(buf: Buffer, mime: string): string {
	return `data:${mime};base64,${buf.toString('base64')}`;
}

// Build the old/new `data:` URLs for an image file from whichever sides exist.
// `oldRef` is the base/HEAD commit; the new side comes from the working tree in
// the unstaged context (no head ref) and from `headRef` otherwise.
async function imageDataUrls(
	repoPath: string,
	filePath: string,
	mime: string,
	oldRef: string | undefined,
	headRef: string | undefined
): Promise<{ oldImage?: string; newImage?: string }> {
	const oldBuf = oldRef ? await showFileBuffer(repoPath, oldRef, filePath) : null;
	const newBuf = headRef
		? await showFileBuffer(repoPath, headRef, filePath)
		: await readWorkingBuffer(repoPath, filePath);
	return {
		oldImage: oldBuf ? bufferToDataUrl(oldBuf, mime) : undefined,
		newImage: newBuf ? bufferToDataUrl(newBuf, mime) : undefined
	};
}

// Build the unified diff git would produce for a brand-new file: a single
// `@@ -0,0 +1,N @@` hunk of all-addition lines, with the `/dev/null` → file
// header `git apply --cached` needs to create it. Lets untracked files flow
// through the same parse/filter/commit path as tracked ones.
function synthesizeAddedFilePatch(filePath: string, contents: string): string {
	const hasFinalNewline = contents.endsWith('\n');
	const body = hasFinalNewline ? contents.slice(0, -1) : contents;
	const lines = body.length === 0 ? [] : body.split('\n');
	if (lines.length === 0) return '';
	const out = [
		`diff --git a/${filePath} b/${filePath}`,
		'new file mode 100644',
		'--- /dev/null',
		`+++ b/${filePath}`,
		`@@ -0,0 +1,${lines.length} @@`,
		...lines.map((l) => `+${l}`)
	];
	if (!hasFinalNewline) out.push('\\ No newline at end of file');
	return out.join('\n') + '\n';
}

export async function getDiff(
	repoPath: string,
	filePath: string,
	ctx: DiffContext
): Promise<DiffData> {
	const git = simpleGit(repoPath);
	const refs = await refsForContext(git, ctx);

	let patch = '';
	let oldContents = '';
	let newContents = '';
	let isBinary = false;
	let additions = 0;
	let deletions = 0;
	let status: FileStatus;

	// The "old" side ref for a base/head comparison. The patch and numstat are
	// three-dot (`base...head`) — they diff against the merge-base, matching how
	// GitHub presents a branch/PR. Read the old side from that same merge-base so
	// the contents Pierre diffs line up with the patch. Reading from the base
	// *tip* instead breaks any file that's identical on the base tip but new
	// since the merge-base (e.g. a changeset that landed on main after this
	// branch diverged): old === new, so Pierre computes an empty diff and renders
	// a blank body even though the patch shows a real addition. Falls back to the
	// base tip when there's no common ancestor.
	let oldSideRef = refs.base;
	if (refs.base && refs.head) {
		const mergeBase = (await git.raw(['merge-base', refs.base, refs.head]).catch(() => '')).trim();
		if (mergeBase) oldSideRef = mergeBase;
	}

	if (refs.workingTree) {
		patch = await git.diff(['HEAD', '--', filePath]).catch(() => '');
		if (!patch) {
			patch = await git.diff(['--', filePath]).catch(() => '');
		}
		oldContents = await showFile(git, 'HEAD', filePath);
		newContents = await readWorkingFile(repoPath, filePath);
		const ns = await safeNumstat(git, undefined, undefined, filePath);
		additions = ns.additions;
		deletions = ns.deletions;
		isBinary = ns.binary;
	} else if (refs.base && refs.head) {
		patch = await git.raw(['diff', `${refs.base}...${refs.head}`, '--', filePath]).catch(() => '');
		oldContents = await showFile(git, oldSideRef!, filePath);
		newContents = await showFile(git, refs.head, filePath);
		const ns = await safeNumstat(git, refs.base, refs.head, filePath);
		additions = ns.additions;
		deletions = ns.deletions;
		isBinary = ns.binary;
	}

	// Images get rendered side by side, so fetch the raw bytes of each side as a
	// `data:` URL. The new side comes from the working tree in the unstaged
	// context (no head ref) and from the head ref otherwise.
	const imageMime = imageMimeForPath(filePath);
	let oldImage: string | undefined;
	let newImage: string | undefined;
	if (imageMime) {
		const oldRef = refs.workingTree ? 'HEAD' : oldSideRef;
		const headRef = refs.workingTree ? undefined : refs.head;
		({ oldImage, newImage } = await imageDataUrls(repoPath, filePath, imageMime, oldRef, headRef));
	}

	// Recompute status from whichever side actually has content. For a binary
	// image the text sides are empty, so fall back to the image sides.
	const hasOld = oldContents.length > 0 || oldImage !== undefined;
	const hasNew = newContents.length > 0 || newImage !== undefined;
	if (hasNew && !hasOld) status = 'added';
	else if (hasOld && !hasNew) status = 'deleted';
	else status = 'modified';

	const truncated = oldContents.length > MAX_FILE_BYTES || newContents.length > MAX_FILE_BYTES;

	// A raster image's "contents" are lossy binary noise — drop them so we don't
	// ship garbage; the side-by-side `data:` URLs are what gets rendered. SVGs
	// are text, so keep their contents for the source diff.
	const dropTextContents = isBinary && imageMime !== null;

	// Untracked/new files aren't in HEAD or the index, so `git diff` yields no
	// patch and per-line staging would be unavailable. Synthesize an added-file
	// patch from the working-tree contents so the staging gutters and the
	// partial-commit path (git apply --cached) work the same as for tracked files.
	if (
		refs.workingTree &&
		!patch &&
		status === 'added' &&
		!isBinary &&
		imageMime === null &&
		!truncated &&
		newContents
	) {
		patch = synthesizeAddedFilePatch(filePath, newContents);
	}

	return {
		file: {
			path: filePath,
			oldPath: undefined,
			status,
			additions,
			deletions,
			isBinary
		},
		patch,
		oldContents: truncated || dropTextContents ? '' : oldContents,
		newContents: truncated || dropTextContents ? '' : newContents,
		truncated,
		oldImage,
		newImage
	};
}

export interface PushStatus {
	branch: string | null;
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	hasRemote: boolean;
	aheadOfDefault: number;
	behindDefault: number;
	pushRemote?: string;
}

// Detect the repo's default branch from local refs. origin/HEAD is only set at
// clone time, so it's commonly absent for locally-created repos; fall back to
// the first conventional default that actually exists (remote-tracking first,
// then local). Returns the bare branch name (no `origin/` prefix).
export async function detectDefaultBranch(git: SimpleGit): Promise<string | undefined> {
	try {
		const head = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
		if (head) return head.replace(/^origin\//, '');
	} catch {
		// origin/HEAD not set — fall through to the conventional candidates.
	}
	const candidates = ['origin/main', 'origin/master', 'origin/trunk', 'main', 'master', 'trunk'];
	for (const ref of candidates) {
		try {
			await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
			return ref.replace(/^origin\//, '');
		} catch {
			// Try the next candidate.
		}
	}
	return undefined;
}

// Path-based wrapper for callers (the IPC layer) that only hold a repo path.
export async function getDefaultBranch(repoPath: string): Promise<string | undefined> {
	return detectDefaultBranch(simpleGit(repoPath));
}

async function countAheadOfDefault(
	git: SimpleGit,
	branch: string,
	defaultBranch: string | undefined,
	hasRemote: boolean
): Promise<number> {
	if (!defaultBranch || branch === defaultBranch) return 0;
	// Resolve against the same ref the "behind" count uses (origin/<default> when
	// available, falling back to the local branch). A freshly cloned repo often
	// has no local <default> branch — only origin/<default> — so a bare
	// `<default>..HEAD` would fail and silently report 0, hiding the Create PR
	// button even though the branch has diverged.
	const ref = await resolveDefaultRef(git, defaultBranch, hasRemote);
	if (!ref) return 0;
	try {
		const out = (await git.raw(['rev-list', '--count', `${ref}..HEAD`])).trim();
		return Number(out) || 0;
	} catch {
		return 0;
	}
}

// Pick the ref that "update from default" would merge in: the remote-tracking
// default (origin/main) when a remote exists, falling back to the local default
// branch. Returns null when neither ref resolves to a commit.
async function resolveDefaultRef(
	git: SimpleGit,
	defaultBranch: string,
	hasRemote: boolean
): Promise<string | null> {
	const candidates = hasRemote ? [`origin/${defaultBranch}`, defaultBranch] : [defaultBranch];
	for (const ref of candidates) {
		try {
			await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
			return ref;
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

// Commits the default branch has that the current branch doesn't — i.e. how far
// behind the default the branch is, and what "update from <default>" would pull
// in. 0 on the default branch itself. Compared against the same ref the update
// merges (origin/<default> when available) so the count matches the action.
async function countBehindDefault(
	git: SimpleGit,
	branch: string,
	defaultBranch: string | undefined,
	hasRemote: boolean
): Promise<number> {
	if (!defaultBranch || branch === defaultBranch) return 0;
	const ref = await resolveDefaultRef(git, defaultBranch, hasRemote);
	if (!ref) return 0;
	try {
		const out = (await git.raw(['rev-list', '--count', `HEAD..${ref}`])).trim();
		return Number(out) || 0;
	} catch {
		return 0;
	}
}

export async function getPushStatus(repoPath: string, defaultBranch?: string): Promise<PushStatus> {
	const git = simpleGit(repoPath);
	let branch: string | null;
	try {
		branch = (await git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || null;
	} catch {
		branch = null;
	}
	const remotes = await git.getRemotes(true).catch(() => []);
	const hasRemote = remotes.some((r) => r.name === 'origin');
	// The caller passes the repo's cached default branch, but that's computed once
	// at repo-add time and persisted — it can be undefined for repos added before
	// detection improved, or stale. Resolve live when it's missing so the ahead/
	// behind-of-default counts (and the Create PR affordance they gate) recover on
	// the next refresh without needing the repo to be re-added.
	const effectiveDefault = defaultBranch ?? (await detectDefaultBranch(git));
	const aheadOfDefault = branch
		? await countAheadOfDefault(git, branch, effectiveDefault, hasRemote)
		: 0;
	const behindDefault = branch
		? await countBehindDefault(git, branch, effectiveDefault, hasRemote)
		: 0;
	if (!branch || !hasRemote) {
		return {
			branch,
			ahead: 0,
			behind: 0,
			hasUpstream: false,
			hasRemote,
			aheadOfDefault,
			behindDefault
		};
	}
	let upstream: string | null;
	try {
		upstream = (
			await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
		).trim();
	} catch {
		upstream = null;
	}
	if (!upstream) {
		return {
			branch,
			ahead: 0,
			behind: 0,
			hasUpstream: false,
			hasRemote,
			aheadOfDefault,
			behindDefault
		};
	}
	let ahead = 0;
	let behind = 0;
	try {
		const counts = (
			await git.raw(['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
		).trim();
		const [b, a] = counts.split(/\s+/).map((n) => Number(n) || 0);
		behind = b;
		ahead = a;
	} catch {
		// ignore
	}
	let pushRemote: string | undefined;
	try {
		pushRemote =
			(await git.raw(['config', '--get', `branch.${branch}.remote`])).trim() || undefined;
	} catch {
		pushRemote = undefined;
	}
	return {
		branch,
		ahead,
		behind,
		hasUpstream: true,
		hasRemote,
		aheadOfDefault,
		behindDefault,
		pushRemote
	};
}

export interface PullPushResult {
	ok: boolean;
	conflicts: string[];
	error?: string;
}

async function listUnmergedPaths(git: SimpleGit): Promise<string[]> {
	try {
		const raw = await git.raw(['diff', '--name-only', '--diff-filter=U']);
		return raw
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export async function pull(repoPath: string): Promise<PullPushResult> {
	const git = simpleGit(repoPath);
	try {
		await git.raw(['pull', '--no-rebase', '--no-edit']);
		return { ok: true, conflicts: [] };
	} catch (err) {
		const conflicts = await listUnmergedPaths(git);
		if (conflicts.length > 0) return { ok: false, conflicts };
		return {
			ok: false,
			conflicts: [],
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// True when a merge is in progress (MERGE_HEAD exists). Distinguishes a real
// merge conflict (finish with a commit) from conflicts left by re-applying
// autostashed work after a fast-forward (no commit to make).
async function hasMergeHead(git: SimpleGit): Promise<boolean> {
	try {
		// simple-git resolves a missing ref as an empty string (exit code swallowed),
		// so key off the output: a SHA when a merge is in progress, '' otherwise.
		const out = await git.raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
		return out.trim().length > 0;
	} catch {
		return false;
	}
}

// When `git merge --autostash` re-applies the stash with conflicts (e.g. after
// a fast-forward), it keeps the work as a backup stash entry labelled
// "autostash". Drop that top entry once the conflicts are resolved. Guarded so
// we never drop a stash the user created themselves.
async function dropAutostashBackup(git: SimpleGit): Promise<void> {
	const list = await git.raw(['stash', 'list']).catch(() => '');
	if (/^stash@\{0\}:.*autostash/m.test(list)) {
		await git.raw(['stash', 'drop']).catch(() => {});
	}
}

// Merge another ref into the current branch — GitHub Desktop's "Update from
// <default>". `--autostash` tucks away uncommitted work so the merge (or a
// fast-forward) isn't blocked by "local changes would be overwritten", then
// re-applies it: git restores the stash automatically when the merge is
// committed or aborted, while a fast-forward re-applies it right away.
// Conflicts (from the merge itself, or from re-applying the stash) surface the
// same way pull() does, so the existing conflict dialog drives the resolution.
export async function mergeIntoCurrent(repoPath: string, ref: string): Promise<PullPushResult> {
	const git = simpleGit(repoPath);
	try {
		await git.raw(['merge', '--no-edit', '--autostash', ref]);
	} catch (err) {
		const conflicts = await listUnmergedPaths(git);
		if (conflicts.length > 0) return { ok: false, conflicts };
		return {
			ok: false,
			conflicts: [],
			error: err instanceof Error ? err.message : String(err)
		};
	}
	// A "successful" (fast-forward) merge can still leave conflicts when the
	// autostash re-apply collides with the freshly merged content — surface them.
	const conflicts = await listUnmergedPaths(git);
	if (conflicts.length > 0) return { ok: false, conflicts };
	return { ok: true, conflicts: [] };
}

// Point an "upstream" remote at `url`, creating it (or repointing an existing
// one) so a fork can fetch from its parent. We use the conventional name so the
// merge ref is stable (`upstream/<branch>`) and repeat fetches are incremental.
async function ensureUpstreamRemote(git: SimpleGit, url: string): Promise<void> {
	const remotes = await git.getRemotes(true).catch(() => []);
	const existing = remotes.find((r) => r.name === 'upstream');
	if (!existing) {
		await git.addRemote('upstream', url);
	} else if (existing.refs.fetch !== url) {
		await git.remote(['set-url', 'upstream', url]);
	}
}

// Point the `upstream` remote at `url` (creating or repointing it). Used when
// switching an existing fork to "contribute to the parent".
export async function addUpstreamRemote(repoPath: string, url: string): Promise<void> {
	await ensureUpstreamRemote(simpleGit(repoPath), url);
}

// Drop the `upstream` remote if present — when a fork is switched to "for my own
// purposes" it no longer tracks a parent. No-op when there's no upstream remote.
export async function removeUpstreamRemote(repoPath: string): Promise<void> {
	const git = simpleGit(repoPath);
	const remotes = await git.getRemotes().catch(() => []);
	if (remotes.some((r) => r.name === 'upstream')) {
		await git.removeRemote('upstream');
	}
}

// GitHub Desktop's "Update from upstream/<branch>": for a fork, fetch the parent
// repo's <branch> and merge it into the current branch. Reuses mergeIntoCurrent
// so any conflicts flow through the same dialog as updateFromDefault.
export async function updateFromUpstream(
	repoPath: string,
	upstreamUrl: string,
	branch: string
): Promise<PullPushResult> {
	const git = simpleGit(repoPath);
	try {
		await ensureUpstreamRemote(git, upstreamUrl);
		await git.fetch(['upstream', branch]);
	} catch (err) {
		return {
			ok: false,
			conflicts: [],
			error: err instanceof Error ? err.message : String(err)
		};
	}
	return mergeIntoCurrent(repoPath, `upstream/${branch}`);
}

export async function push(repoPath: string): Promise<PullPushResult> {
	const git = simpleGit(repoPath);
	try {
		const status = await getPushStatus(repoPath);
		if (!status.branch) throw new Error('Not on a branch (detached HEAD).');
		if (!status.hasRemote) throw new Error("No 'origin' remote configured.");
		const args = ['push'];
		if (!status.hasUpstream) args.push('--set-upstream', 'origin', status.branch);
		await git.raw(args);
		return { ok: true, conflicts: [] };
	} catch (err) {
		return {
			ok: false,
			conflicts: [],
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

export async function getConflicts(repoPath: string): Promise<string[]> {
	return listUnmergedPaths(simpleGit(repoPath));
}

// Re-scan the given conflict files for leftover conflict markers. Any file that
// no longer has markers is staged (marking it resolved for the merge), so the
// caller doesn't need an explicit "mark resolved" step — editing the file away
// from its markers is enough. Returns the paths that are still unresolved (so
// the UI can show an alert vs. a check per file). We key off `<<<<<<<`/`>>>>>>>`
// rather than `=======` since a row of equals is legitimate Markdown.
export async function recheckConflicts(repoPath: string, files: string[]): Promise<string[]> {
	const git = simpleGit(repoPath);
	const hasMarkers = (content: string): boolean => /^<{7}|^>{7}/m.test(content);
	for (const f of files) {
		const content = await fs.readFile(path.join(repoPath, f), 'utf8').catch(() => '');
		// On a read error we leave the file unstaged (treated as unresolved).
		if (content !== '' && !hasMarkers(content)) {
			await git.add([f]).catch(() => {});
		}
	}
	return listUnmergedPaths(git);
}

export async function stageFile(repoPath: string, filePath: string): Promise<void> {
	await simpleGit(repoPath).add([filePath]);
}

// Whether `relPath` exists in the current HEAD commit. False for new/untracked
// files and for repos with no commits yet (`HEAD:<path>` can't be resolved).
async function pathExistsInHead(git: SimpleGit, relPath: string): Promise<boolean> {
	try {
		await git.raw(['cat-file', '-e', `HEAD:${relPath}`]);
		return true;
	} catch {
		return false;
	}
}

// Discard a file's working-tree (and staged) changes, mirroring GitHub
// Desktop's "Discard Changes". Tracked files are reset to their HEAD state
// (recoverable from history); files with no HEAD version — new or untracked —
// are removed via the injected `trash` callback so the discard can stay
// recoverable (the desktop app passes a move-to-OS-trash implementation; with
// no callback we hard-remove the file). `oldPath` is the pre-rename path: a
// rename also leaves the original deleted from the worktree, so we restore it
// too.
//
// `trash` is dependency-injected rather than reaching for `electron` directly,
// so this module stays Electron-free and importable from the plain-node CLI
// (which captures sessions but never discards files).
export async function discardChanges(
	repoPath: string,
	filePath: string,
	oldPath?: string,
	trash?: (absPath: string) => Promise<void>
): Promise<void> {
	const git = simpleGit(repoPath);
	const restoreOrTrash = async (relPath: string): Promise<void> => {
		const inHead = await pathExistsInHead(git, relPath);
		// Unstage first so the worktree restore (or trash) isn't left partial.
		await git.raw(['reset', '-q', 'HEAD', '--', relPath]).catch(() => {});
		if (inHead) {
			await git.raw(['checkout', 'HEAD', '--', relPath]);
		} else {
			const absPath = path.join(repoPath, relPath);
			if (trash) {
				await trash(absPath).catch(() => {});
			} else {
				await fs.rm(absPath, { force: true }).catch(() => {});
			}
		}
	};
	await restoreOrTrash(filePath);
	if (oldPath && oldPath !== filePath) await restoreOrTrash(oldPath);
}

// Try to wrap up an in-progress merge once the user has resolved conflicts. If
// unmerged paths remain we surface them again. When a merge is in progress we
// create the merge commit (which also re-applies any `--autostash` work, and
// that re-apply can itself conflict — so we re-check). When there's no merge in
// progress, the conflicts came from re-applying autostashed changes after a
// fast-forward: nothing to commit — the resolved work stays uncommitted and we
// just clear the backup stash git kept.
export async function continueMerge(repoPath: string): Promise<PullPushResult> {
	const git = simpleGit(repoPath);
	let remaining = await listUnmergedPaths(git);
	if (remaining.length > 0) return { ok: false, conflicts: remaining };
	if (!(await hasMergeHead(git))) {
		await dropAutostashBackup(git);
		return { ok: true, conflicts: [] };
	}
	try {
		await git.raw(['commit', '--no-edit']);
	} catch (err) {
		return {
			ok: false,
			conflicts: [],
			error: err instanceof Error ? err.message : String(err)
		};
	}
	// Committing the merge re-applies the autostash, which may conflict in turn.
	remaining = await listUnmergedPaths(git);
	if (remaining.length > 0) return { ok: false, conflicts: remaining };
	return { ok: true, conflicts: [] };
}

export async function abortMerge(repoPath: string): Promise<void> {
	const git = simpleGit(repoPath);
	if (await hasMergeHead(git)) {
		// `merge --abort` also restores any `--autostash` work automatically.
		await git.raw(['merge', '--abort']).catch(() => {});
		return;
	}
	// No merge in progress: the conflicts are from re-applying autostashed work
	// after a fast-forward. Recover the pre-update state by undoing the
	// fast-forward (ORIG_HEAD) and popping the backup stash — but only when that
	// backup exists, so we never destroy work we can't restore.
	const list = await git.raw(['stash', 'list']).catch(() => '');
	if (/^stash@\{0\}:.*autostash/m.test(list)) {
		await git.raw(['reset', '--hard', 'ORIG_HEAD']).catch(() => {});
		await git.raw(['stash', 'pop']).catch(() => {});
	}
}

export interface CommitResult {
	ok: boolean;
	error?: string;
}

// Stages and commits the selected files. Whole-file selections stage the file's
// full working-tree version; partial selections carry a unified diff (HEAD ->
// the kept subset) for line/hunk staging. When nothing is partial we take the
// original fast path (`git add` + a pathspec-pinned `git commit`); otherwise we
// build the commit through a scratch index so only the selected lines land.
export async function commit(
	repoPath: string,
	message: string,
	files: CommitFileSelection[],
	identity?: GitIdentity | null
): Promise<CommitResult> {
	const git = simpleGit(repoPath);
	try {
		const trimmed = message.trim();
		if (!trimmed) throw new Error('Commit message is required.');
		if (files.length === 0) throw new Error('No files selected to commit.');

		const hasPartial = files.some((f) => f.patch != null && f.patch.trim() !== '');
		if (!hasPartial) {
			// Whole-file fast path. For renames we stage both sides so git records
			// the move rather than an add + orphaned delete.
			const paths: string[] = [];
			for (const f of files) {
				paths.push(f.path);
				if (f.oldPath && f.oldPath !== f.path) paths.push(f.oldPath);
			}
			await git.raw(['add', '-A', '--', ...paths]);
			// `-c` sets config for this invocation only, overriding both author and
			// committer without touching the repo's git config.
			const identityArgs = identity
				? ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`]
				: [];
			// Pin the commit to the selected pathspecs so anything else that may be
			// staged in the index is left out — only the checked files are committed.
			await git.raw([...identityArgs, 'commit', '-m', trimmed, '--', ...paths]);
			return { ok: true };
		}

		await commitPartial(repoPath, trimmed, files, identity);
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// Build a commit from a partial (line/hunk) selection without disturbing the
// user's real index. We assemble the desired tree in a scratch index seeded
// from HEAD: whole-file entries are `git add`ed, partial entries have their
// reduced patch applied with `git apply --cached`. We then write that tree,
// create the commit with `git commit-tree`, advance the branch, and finally
// reset the real index for the touched paths to the new HEAD so `git status`
// shows the committed changes gone and any unselected leftovers as unstaged.
async function commitPartial(
	repoPath: string,
	message: string,
	files: CommitFileSelection[],
	identity?: GitIdentity | null
): Promise<void> {
	const baseGit = simpleGit(repoPath);
	const gitDir = (await baseGit.raw(['rev-parse', '--absolute-git-dir'])).trim();
	const headExists = await revExists(baseGit, 'HEAD');
	const unique = `${process.pid}-${Date.now()}`;
	const tmpIndex = path.join(gitDir, `super-review-index-${unique}`);
	const tmpPatchFiles: string[] = [];

	// All index-mutating commands run against the scratch index via GIT_INDEX_FILE.
	// simple-git refuses to spawn with editor vars in a custom env (its
	// allowUnsafeEditor guard); none of our commands open an editor (commit-tree
	// takes `-m`), so drop them rather than weaken the guard. Cast through unknown
	// because process.env's values are `string | undefined`.
	const baseEnv: Record<string, string> = { ...process.env } as Record<string, string>;
	delete baseEnv.GIT_EDITOR;
	delete baseEnv.GIT_SEQUENCE_EDITOR;
	const indexEnv: Record<string, string> = { ...baseEnv, GIT_INDEX_FILE: tmpIndex };
	const idxGit = simpleGit(repoPath).env(indexEnv);

	try {
		// Seed the scratch index from HEAD (empty for an unborn branch).
		await idxGit.raw(headExists ? ['read-tree', 'HEAD'] : ['read-tree', '--empty']);

		for (const f of files) {
			if (f.patch != null && f.patch.trim() !== '') {
				const patchPath = path.join(
					gitDir,
					`super-review-patch-${unique}-${tmpPatchFiles.length}.patch`
				);
				const text = f.patch.endsWith('\n') ? f.patch : `${f.patch}\n`;
				await fs.writeFile(patchPath, text, 'utf8');
				tmpPatchFiles.push(patchPath);
				// Apply against the scratch index only (which mirrors HEAD, the patch's
				// base). `--whitespace=nowarn` keeps benign whitespace from aborting.
				await idxGit.raw(['apply', '--cached', '--whitespace=nowarn', patchPath]);
			} else {
				const paths = [f.path];
				if (f.oldPath && f.oldPath !== f.path) paths.push(f.oldPath);
				await idxGit.raw(['add', '-A', '--', ...paths]);
			}
		}

		const tree = (await idxGit.raw(['write-tree'])).trim();
		const commitEnv: Record<string, string> = { ...indexEnv };
		if (identity) {
			commitEnv.GIT_AUTHOR_NAME = identity.name;
			commitEnv.GIT_AUTHOR_EMAIL = identity.email;
			commitEnv.GIT_COMMITTER_NAME = identity.name;
			commitEnv.GIT_COMMITTER_EMAIL = identity.email;
		}
		const commitArgs = ['commit-tree', tree, '-m', message];
		if (headExists) commitArgs.push('-p', 'HEAD');
		const newSha = (await simpleGit(repoPath).env(commitEnv).raw(commitArgs)).trim();

		// Advance the current branch (or detached HEAD) to the new commit.
		await baseGit.raw(['update-ref', 'HEAD', newSha]);

		// Reconcile the real index for the touched paths against the new HEAD so the
		// committed parts disappear from `git status` and partial leftovers show as
		// unstaged. Untouched paths (anything the user may have staged manually) are
		// left alone.
		const touched: string[] = [];
		for (const f of files) {
			touched.push(f.path);
			if (f.oldPath && f.oldPath !== f.path) touched.push(f.oldPath);
		}
		await baseGit.raw(['reset', '-q', 'HEAD', '--', ...touched]).catch(() => {});
	} finally {
		await fs.rm(tmpIndex, { force: true }).catch(() => {});
		for (const p of tmpPatchFiles) await fs.rm(p, { force: true }).catch(() => {});
	}
}

export interface LastCommit {
	hash: string;
	subject: string;
	// Relative time string straight from git (e.g. "2 minutes ago").
	relativeTime: string;
	// True when the commit has not yet been pushed to any remote, so undoing it
	// is safe (won't rewrite shared history).
	canUndo: boolean;
}

// Returns the tip commit of HEAD plus whether it is safe to undo. `null` when
// the branch has no commits yet.
export async function getLastCommit(repoPath: string): Promise<LastCommit | null> {
	const git = simpleGit(repoPath);
	try {
		const raw = (await git.raw(['log', '-1', '--pretty=format:%H%x1f%s%x1f%cr'])).trim();
		if (!raw) return null;
		const [hash, subject, relativeTime] = raw.split('');
		// Count commits reachable from HEAD but not from any remote-tracking
		// branch. >0 means the tip is local-only and can be undone. With no remotes
		// at all this counts every commit, which is the behavior we want.
		let canUndo = true;
		try {
			const unpushed =
				Number((await git.raw(['rev-list', '--count', 'HEAD', '--not', '--remotes'])).trim()) || 0;
			canUndo = unpushed > 0;
		} catch {
			canUndo = true;
		}
		return { hash, subject, relativeTime, canUndo };
	} catch {
		return null;
	}
}

// Undoes the last commit while keeping its changes staged in the index, the
// same way GitHub Desktop's "Undo" affordance works (git reset --soft HEAD~1).
// When the tip is the repo's only commit, drop the HEAD ref instead so the
// index is preserved.
export async function undoLastCommit(repoPath: string): Promise<CommitResult> {
	const git = simpleGit(repoPath);
	try {
		const count = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim()) || 0;
		if (count <= 0) throw new Error('No commit to undo.');
		if (count === 1) {
			await git.raw(['update-ref', '-d', 'HEAD']);
		} else {
			await git.raw(['reset', '--soft', 'HEAD~1']);
		}
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

export interface CloneResult {
	ok: boolean;
	path?: string;
	error?: string;
}

// Clones the given URL into `parentDir/<repo-name>`. Caller is responsible for
// validating the parent dir exists and is writable.
export async function cloneRepo(url: string, parentDir: string): Promise<CloneResult> {
	const trimmed = url.trim();
	if (!trimmed) return { ok: false, error: 'Repository URL is required.' };
	const name = trimmed
		.replace(/\.git$/, '')
		.split(/[/:]/)
		.pop();
	if (!name) return { ok: false, error: 'Could not parse repository name from URL.' };
	const target = path.join(parentDir, name);
	try {
		const exists = await fs
			.stat(target)
			.then(() => true)
			.catch(() => false);
		if (exists) {
			return { ok: false, error: `Destination already exists: ${target}` };
		}
		await simpleGit().clone(trimmed, target);
		return { ok: true, path: target };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// Create a new repository at `<path>/<name>`, GitHub-Desktop style: make the
// folder, run `git init`, then scaffold the requested README / .gitignore /
// LICENSE. The seed files are left uncommitted on purpose — they show up as the
// repo's first set of changes, ready for the user to make the initial commit.
export async function createRepo(opts: CreateRepoOptions): Promise<CloneResult> {
	const name = opts.name.trim();
	if (!name) return { ok: false, error: 'Repository name is required.' };
	// Disallow path separators so `name` can't escape the chosen parent folder.
	if (/[/\\]/.test(name) || name === '.' || name === '..') {
		return { ok: false, error: `Invalid repository name: ${name}` };
	}
	const parent = opts.path.trim();
	if (!parent) return { ok: false, error: 'Local path is required.' };

	const target = path.join(parent, name);
	try {
		const existing = await fs.stat(target).catch(() => null);
		if (existing) {
			if (!existing.isDirectory()) {
				return { ok: false, error: `Not a directory: ${target}` };
			}
			if (await isGitRepo(target)) {
				return {
					ok: false,
					error: `A repository already exists at: ${target}`
				};
			}
			// A non-empty, non-repo directory: refuse rather than scribble into it.
			const entries = await fs.readdir(target);
			if (entries.length > 0) {
				return { ok: false, error: `Directory is not empty: ${target}` };
			}
		} else {
			await fs.mkdir(target, { recursive: true });
		}

		const git = simpleGit(target);
		await git.init();

		const description = opts.description?.trim() ?? '';
		if (description) {
			// .git/description is plumbing GitHub Desktop also populates; harmless if
			// it can't be written (e.g. a bare-ish layout).
			await fs
				.writeFile(path.join(target, '.git', 'description'), `${description}\n`)
				.catch(() => {});
		}

		if (opts.initReadme) {
			const body = description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
			await fs.writeFile(path.join(target, 'README.md'), body);
		}

		if (opts.gitignore) {
			const content = getGitignore(opts.gitignore);
			if (content) await fs.writeFile(path.join(target, '.gitignore'), content);
		}

		if (opts.license) {
			const author = (await readGitUserName(git)) || name;
			const content = getLicense(opts.license, {
				year: new Date().getFullYear(),
				author
			});
			if (content) await fs.writeFile(path.join(target, 'LICENSE'), content);
		}

		return { ok: true, path: target };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// Best-effort read of the configured git author name for license attribution.
async function readGitUserName(git: SimpleGit): Promise<string> {
	try {
		return (await git.raw(['config', 'user.name'])).trim();
	} catch {
		return '';
	}
}

// Whether the repo has at least one commit (HEAD resolves to a commit). Note:
// we deliberately do NOT pass `--quiet` — on an unborn branch git would then
// exit 1 with no stderr, which simple-git resolves as success (empty string),
// making this always report true. Without `--quiet` it exits 128 with a fatal
// message, which simple-git surfaces as a rejection we can catch.
async function headExists(git: SimpleGit): Promise<boolean> {
	try {
		await git.raw(['rev-parse', '--verify', 'HEAD']);
		return true;
	} catch {
		return false;
	}
}

// Ensure the repo has an initial commit before we try to push it. On a brand-new
// repo the seeded README/.gitignore/LICENSE are left uncommitted, so the branch
// is unborn and `git push` would fail with "src refspec … does not match any".
// When there are no commits yet we stage everything and make the first commit
// (using the GitHub account identity so it's attributed correctly), mirroring
// GitHub Desktop. `--allow-empty` covers the edge case of a repo with no files.
// No-op (returns false) when commits already exist. Throws on real git errors.
export async function ensureInitialCommit(
	repoPath: string,
	message: string,
	identity?: GitIdentity | null
): Promise<boolean> {
	const git = simpleGit(repoPath);
	if (await headExists(git)) return false;
	await git.raw(['add', '-A']);
	// Strip the editor vars: simple-git rejects commands when GIT_EDITOR /
	// GIT_SEQUENCE_EDITOR are set (its allowUnsafeEditor guard), and `commit -m`
	// needs no editor anyway. Mirrors the commit() helper above.
	const env: Record<string, string> = { ...process.env } as Record<string, string>;
	delete env.GIT_EDITOR;
	delete env.GIT_SEQUENCE_EDITOR;
	if (identity) {
		env.GIT_AUTHOR_NAME = identity.name;
		env.GIT_AUTHOR_EMAIL = identity.email;
		env.GIT_COMMITTER_NAME = identity.name;
		env.GIT_COMMITTER_EMAIL = identity.email;
	}
	await simpleGit(repoPath).env(env).raw(['commit', '--allow-empty', '-m', message]);
	return true;
}

// Point 'origin' at `remoteUrl` and push the current branch, setting it as the
// upstream. Used by the "Publish to GitHub" flow after the remote repo has been
// created via the API. Auth follows the same path as cloneRepo/push: the user's
// system git credential helper — we never write a token into the repo config.
export async function setOriginAndPush(
	repoPath: string,
	remoteUrl: string
): Promise<PullPushResult> {
	const git = simpleGit(repoPath);
	try {
		const branch = await getCurrentBranch(repoPath);
		if (!branch) throw new Error('Not on a branch (detached HEAD).');
		const remotes = await git.getRemotes().catch(() => []);
		if (remotes.some((r) => r.name === 'origin')) {
			await git.raw(['remote', 'set-url', 'origin', remoteUrl]);
		} else {
			await git.raw(['remote', 'add', 'origin', remoteUrl]);
		}
		await git.raw(['push', '--set-upstream', 'origin', branch]);
		return { ok: true, conflicts: [] };
	} catch (err) {
		return {
			ok: false,
			conflicts: [],
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// Repoint `origin` at the user's fork — GitHub Desktop's fork layout (push to
// your fork). When `upstreamUrl` is given (contributing to the parent), the
// original repo is kept as `upstream` for syncing/PRs; omit it for a fork worked
// on "for my own purposes". No push: the caller commits/pushes through the
// normal path afterward, where `push()` sets the branch's upstream to `origin`.
export async function convertToForkRemotes(
	repoPath: string,
	forkUrl: string,
	upstreamUrl?: string | null
): Promise<void> {
	const git = simpleGit(repoPath);
	const remotes = await git.getRemotes().catch(() => []);
	if (remotes.some((r) => r.name === 'origin')) {
		await git.raw(['remote', 'set-url', 'origin', forkUrl]);
	} else {
		await git.raw(['remote', 'add', 'origin', forkUrl]);
	}
	if (upstreamUrl) await ensureUpstreamRemote(git, upstreamUrl);
}

export async function fetchOrigin(repoPath: string): Promise<{ ok: boolean; error?: string }> {
	try {
		const git = simpleGit(repoPath);
		await git.fetch(['origin', '--prune']);
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

export async function fetchPRRef(
	repoPath: string,
	prNumber: number,
	// Remote to read the PR's `pull/<n>/head` ref from — a name ("origin") or a
	// bare URL. For an upstream PR on a fork the PR lives in the parent repo, not
	// origin, so the caller passes the parent's URL.
	remote = 'origin'
): Promise<{ headRef: string; baseRef: string }> {
	const git = simpleGit(repoPath);
	await git.fetch([remote, `pull/${prNumber}/head:refs/pr/${prNumber}/head`]).catch(() => {});
	// base ref is whatever the PR base branch's tip is — we fetch and pin locally
	// The actual base branch name comes from the GitHub API and is resolved by the caller.
	return {
		headRef: `pr/${prNumber}/head`,
		baseRef: `pr/${prNumber}/base`
	};
}

// Check out the branch a PR was opened from so it can be reviewed locally. If
// a local branch with the PR's head name already exists (the common case for
export interface CheckoutPROptions {
	prNumber: number;
	// The PR head branch name; also used as the local branch name so a plain
	// `git push` (push.default=simple) targets the matching remote branch.
	headRef: string;
	// Clone URL + owner of the repo the head branch lives in (the push target).
	// Undefined when the head repo was deleted — we then fall back to a
	// read-only snapshot with no push tracking.
	headRepoUrl?: string;
	headRepoOwner?: string;
	// The fork's own remote URL, so we can reuse "origin" instead of adding a
	// duplicate remote when the head repo is the fork itself.
	originUrl?: string;
	// Remote (name or URL) to read the PR head snapshot from in the fallback
	// path, when the head repo is unknown.
	fallbackRemote?: string;
}

// Check out the branch a PR was opened from so it can be reviewed — and so
// commits can be pushed back to it. We point a remote at the PR's head repo
// (reusing "origin" or any existing remote already aimed there, otherwise
// adding one named after the head owner), fetch the head branch, and create a
// local branch that tracks it. Tracking is what makes the commit box show
// "View PR"/"Push" instead of "Publish", and routes `git push` to the PR's
// branch (which fails cleanly when you lack write access).
//
// When the head repo is unknown (deleted fork), we fall back to fetching a
// read-only `pull/<n>/head` snapshot with no tracking.
export async function checkoutPR(repoPath: string, opts: CheckoutPROptions): Promise<void> {
	const git = simpleGit(repoPath);
	const { prNumber, headRef, headRepoUrl, headRepoOwner } = opts;

	if (!headRepoUrl || !headRepoOwner) {
		const local = await git.branchLocal();
		if (!local.all.includes(headRef)) {
			await git.fetch([opts.fallbackRemote ?? 'origin', `pull/${prNumber}/head:${headRef}`]);
		}
		await git.checkout(headRef);
		return;
	}

	const remote = await ensureRemoteForUrl(git, headRepoOwner, headRepoUrl, opts.originUrl);
	await git.fetch([remote, headRef]);

	const local = await git.branchLocal();
	if (local.all.includes(headRef)) {
		await git.checkout(headRef);
		// Re-point tracking in case this branch previously tracked elsewhere.
		await git.raw(['branch', `--set-upstream-to=${remote}/${headRef}`, headRef]).catch(() => {});
	} else {
		await git.checkout(['-b', headRef, '--track', `${remote}/${headRef}`]);
	}
}

// True when two remote URLs point at the same github.com owner/repo, ignoring
// protocol (SSH vs HTTPS) and a trailing ".git".
async function sameGithubRepo(a: string, b: string): Promise<boolean> {
	const ga = await parseGithubFromUrl(a);
	const gb = await parseGithubFromUrl(b);
	return (
		!!ga &&
		!!gb &&
		ga.owner.toLowerCase() === gb.owner.toLowerCase() &&
		ga.repo.toLowerCase() === gb.repo.toLowerCase()
	);
}

function sanitizeRemoteName(owner: string): string {
	return owner.replace(/[^A-Za-z0-9._-]/g, '-') || 'fork';
}

// Resolve a remote name pointing at `url`, reusing "origin" or any existing
// remote already aimed at that repo; otherwise add one named after `owner`.
async function ensureRemoteForUrl(
	git: SimpleGit,
	owner: string,
	url: string,
	originUrl?: string
): Promise<string> {
	if (originUrl && (await sameGithubRepo(originUrl, url))) return 'origin';
	const remotes = await git.getRemotes(true).catch(() => []);
	for (const r of remotes) {
		if (r.refs.fetch && (await sameGithubRepo(r.refs.fetch, url))) return r.name;
	}
	let name = sanitizeRemoteName(owner);
	// The preferred name is taken by a remote pointing elsewhere (none matched
	// the URL above) — don't clobber it (e.g. "origin"); use a PR-scoped name.
	if (remotes.some((r) => r.name === name)) name = `pr-${name}`;
	if (remotes.some((r) => r.name === name)) {
		await git.remote(['set-url', name, url]);
	} else {
		await git.addRemote(name, url);
	}
	return name;
}

export async function pinPRBaseRef(
	repoPath: string,
	prNumber: number,
	baseBranch: string,
	// Remote the base branch lives on — origin for a same-repo PR, or the parent
	// repo's URL for an upstream PR on a fork. See fetchPRRef.
	remote = 'origin'
): Promise<void> {
	const git = simpleGit(repoPath);
	// Fetch the base branch's current tip straight into the pinned ref. Writing
	// the refspec directly (rather than fetching a tracking ref then resolving
	// it) means this works whether `remote` is a named remote ("origin") or a
	// bare URL — the latter being what we pass for an upstream PR, whose base
	// repo we don't keep a permanent remote for.
	await git.fetch([remote, `+refs/heads/${baseBranch}:refs/pr/${prNumber}/base`]).catch(() => {});
}
