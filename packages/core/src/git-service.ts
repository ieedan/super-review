import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git';
import { createHash } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import os from 'node:os';
import path from 'node:path';
import type {
	BranchInfo,
	ChangedFile,
	CommitFileSelection,
	CommitInfo,
	CommitResult,
	CommitSigning,
	CreateRepoOptions,
	DiffContext,
	DiffData,
	DiscardTarget,
	FileStatus,
	GitIdentity,
	LocalOnlyBranch,
	ManagedStash,
	RepoInfo
} from './types.js';
import { imageMimeForPath } from './media.js';
import { getGitignore, getLicense } from './repo-templates.js';

const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

// A single line longer than this chokes the diff renderer — the browser can't
// lay out one enormous unwrapped line, so the diff paints blank. Treat such a
// file as too large to render (same as the byte cap) and show the placeholder
// instead. Generated/minified blobs (e.g. embedded session JSON) hit this even
// when their total size is under MAX_FILE_BYTES.
const MAX_RENDER_LINE_BYTES = 100 * 1024;

// True when either side is too large for the renderer: over the byte cap, or
// containing a single line long enough to stall layout.
function tooLargeToRender(oldContents: string, newContents: string): boolean {
	return (
		oldContents.length > MAX_FILE_BYTES ||
		newContents.length > MAX_FILE_BYTES ||
		hasOverlongLine(oldContents) ||
		hasOverlongLine(newContents)
	);
}

// Scan for a line over MAX_RENDER_LINE_BYTES without splitting the whole string
// into an array (these inputs can be multi-MB).
function hasOverlongLine(contents: string): boolean {
	let start = 0;
	for (;;) {
		const nl = contents.indexOf('\n', start);
		if (nl === -1) return contents.length - start > MAX_RENDER_LINE_BYTES;
		if (nl - start > MAX_RENDER_LINE_BYTES) return true;
		start = nl + 1;
	}
}

// Images are embedded as base64 `data:` URLs and shipped whole over IPC, so the
// cap is higher than the text cap (images are routinely a few MB) but still
// bounded — past this we leave the side unrendered rather than balloon memory.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// --- Remote authentication -------------------------------------------------
//
// Git transport (push/pull/fetch/clone) shells out to the system `git`, which
// authenticates HTTPS remotes through the OS credential helper — entirely
// separate from the GitHub account signed into the app. For a private repo that
// leaves git effectively unauthenticated, so GitHub answers the generic
// "Repository not found". To bridge the app's OAuth token to git, the host app
// registers a credential provider; for each HTTPS remote we then pass the token
// as an `http.<origin>.extraHeader` via simple-git's `config` option (i.e.
// `git -c …`). That keeps the credential host-scoped, ephemeral (never written
// into the repo config), and applied only to that host's requests.

export interface GitCredentials {
	username: string;
	password: string;
}

// Resolve credentials for a remote URL, or return null to defer to the system
// credential helper (the previous behaviour). Registered by the host app.
export type GitCredentialProvider = (remoteUrl: string) => GitCredentials | null;

let credentialProvider: GitCredentialProvider | null = null;

export function setGitCredentialProvider(provider: GitCredentialProvider | null): void {
	credentialProvider = provider;
}

// `-c` config entries attaching the credential as an Authorization header,
// scoped to the remote's origin (e.g. https://github.com/). Empty when there's
// no provider, the provider declines, or the remote isn't an HTTPS URL we can
// scope to (e.g. scp-style `git@github.com:…`, which uses SSH keys anyway).
function authConfig(remoteUrl: string | null | undefined): string[] {
	if (!remoteUrl || !credentialProvider) return [];
	let origin: string;
	try {
		const u = new URL(remoteUrl);
		if (u.protocol !== 'https:') return [];
		origin = u.origin; // strips any embedded user:pass and the path
	} catch {
		return [];
	}
	const creds = credentialProvider(remoteUrl);
	if (!creds) return [];
	const basic = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
	// Everything after the first `=` is the header value, so the colons/spaces in
	// it are fine — it travels as a single argv entry, never through a shell.
	return [`http.${origin}/.extraHeader=Authorization: Basic ${basic}`];
}

// Every simple-git instance in this module is created through here so they all
// share one crucial setting: GIT_OPTIONAL_LOCKS=0. That tells git to skip the
// *optional* index lock it would otherwise take to refresh the stat cache as a
// side effect of read-only commands (status, diff, log). Those background reads
// fire constantly (file-list refreshes, push-status polling) and, left on, they
// race the real writes for `.git/index.lock` and produce spurious "Unable to
// create index.lock: File exists" failures. The flag only suppresses *optional*
// locks: genuine index writes (commit, reset, checkout, add) still take the lock
// they need, so correctness is unaffected. `.env()` replaces the child env
// wholesale, so we spread process.env; callers that set their own env for a
// scratch index (commitPartial) override this, which is fine since those are
// writes that legitimately hold the lock anyway.
//
// GIT_EDITOR / GIT_SEQUENCE_EDITOR are stripped: simple-git refuses to spawn
// with a custom env carrying editor vars (its allowUnsafeEditor guard), and none
// of our commands open an editor. This mirrors commitPartial's own env handling.
function openGit(repoPath: string | null, options?: Partial<SimpleGitOptions>): SimpleGit {
	const git = repoPath ? simpleGit(repoPath, options) : options ? simpleGit(options) : simpleGit();
	const env: Record<string, string> = { ...process.env, GIT_OPTIONAL_LOCKS: '0' } as Record<
		string,
		string
	>;
	delete env.GIT_EDITOR;
	delete env.GIT_SEQUENCE_EDITOR;
	return git.env(env);
}

// A simple-git instance for `repoPath` with credentials wired in for
// `remoteUrl` when a provider supplies them; a plain instance otherwise. Pass a
// null `repoPath` for repo-less operations like clone.
function authedGit(repoPath: string | null, remoteUrl: string | null | undefined): SimpleGit {
	const config = authConfig(remoteUrl);
	const options = config.length ? { config } : undefined;
	return openGit(repoPath, options);
}

// ── Per-repo write serialization ─────────────────────────────────────────────
// Git guards the index with `.git/index.lock`: it is created for the duration of
// any index-touching command and removed on exit. Two index writes that overlap
// race for that lock — the loser aborts with "Unable to create index.lock: File
// exists" — and a write interrupted mid-flight (a crash, the app quitting, a
// killed helper) leaves the lock behind so every later command fails until it is
// removed by hand. The desktop app dispatches git operations from independent
// IPC calls, so nothing stops two writes from overlapping. We serialize every
// index/ref-mutating operation per repo through a promise chain. Reads are
// deliberately exempt (see openGit): with optional locks off they never take
// index.lock, so they run concurrently and cannot collide with a write.
const writeChains = new Map<string, Promise<unknown>>();

// Which repo write-locks the current async call stack already holds. A wrapped
// operation that calls another wrapped operation on the same repo (e.g.
// updateFromUpstream -> mergeIntoCurrent) would deadlock on a plain mutex; the
// ALS store lets the nested call see it already owns the lock and run inline.
const heldWriteLocks = new AsyncLocalStorage<Set<string>>();

// A lingering index.lock is only ever removed if it is at least this old. Our
// own writes are serialized and brief, so any lock still present here belongs to
// an external process or a crash; the age gate avoids yanking a lock a live
// external command is actively (and briefly) holding.
const INDEX_LOCK_STALE_MS = 10_000;

// Serialize `fn` against all other writes to `repoPath`. Reentrant per repo so
// composed operations don't deadlock. On an index.lock collision it attempts a
// one-shot stale-lock recovery and retries.
export async function withRepoWriteLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
	const key = path.resolve(repoPath);
	const held = heldWriteLocks.getStore();
	if (held?.has(key)) return fn(); // already inside this repo's lock — run inline

	const prev = writeChains.get(key) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	// The next waiter chains off our gate; a prior task's rejection is not ours to
	// inherit, so swallow it either way.
	writeChains.set(
		key,
		prev.then(
			() => gate,
			() => gate
		)
	);
	await prev.catch(() => {}); // wait our turn

	const nextHeld = new Set(held);
	nextHeld.add(key);
	try {
		return await heldWriteLocks.run(nextHeld, () => runWriteWithLockRecovery(key, fn));
	} finally {
		release();
	}
}

function isIndexLockCollision(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes('index.lock') && /file exists|already exists|unable to create/i.test(msg);
}

async function runWriteWithLockRecovery<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (!isIndexLockCollision(err)) throw err;
		// Our writes are serialized, so a lock still present here is not ours — it
		// belongs to a crashed process or an external git run. Remove it only if it
		// is clearly stale, then retry once. A collision on a *young* lock means a
		// live external command holds it, so we surface the error rather than risk
		// corrupting that operation's index.
		const cleared = await removeStaleIndexLock(repoPath);
		if (!cleared) throw err;
		return await fn();
	}
}

// Remove `.git/index.lock` if it exists and is older than INDEX_LOCK_STALE_MS.
// Returns whether a lock was actually removed.
async function removeStaleIndexLock(repoPath: string): Promise<boolean> {
	try {
		const gitDir = (await openGit(repoPath).raw(['rev-parse', '--absolute-git-dir'])).trim();
		const lockPath = path.join(gitDir, 'index.lock');
		const stat = await fs.stat(lockPath).catch(() => null);
		if (!stat) return false;
		if (Date.now() - stat.mtimeMs < INDEX_LOCK_STALE_MS) return false; // maybe live
		await fs.rm(lockPath, { force: true });
		return true;
	} catch {
		return false;
	}
}

// Wrap a `(repoPath, ...args)` operation so every call serializes on that repo's
// write lock. Used to turn the bare index/ref-mutating implementations below
// into their exported, lock-guarded forms without threading the lock through
// each body.
function lockWrite<A extends unknown[], R>(
	fn: (repoPath: string, ...args: A) => Promise<R>
): (repoPath: string, ...args: A) => Promise<R> {
	return (repoPath, ...args) => withRepoWriteLock(repoPath, () => fn(repoPath, ...args));
}

// The exported, write-serialized forms of the index/ref-mutating operations. Each
// wraps its bare `*Impl` in the per-repo write lock so no two can touch the same
// repo's index at once. The `*Impl` bodies are hoisted (function declarations),
// so referencing them here before their textual definition is fine. Reentrancy
// (see withRepoWriteLock) keeps a wrapped op that calls another wrapped op on the
// same repo — e.g. updateFromUpstream -> mergeIntoCurrent — from deadlocking.
export const checkout = lockWrite(checkoutImpl);
export const createBranch = lockWrite(createBranchImpl);
export const deleteBranch = lockWrite(deleteBranchImpl);
export const pull = lockWrite(pullImpl);
export const mergeIntoCurrent = lockWrite(mergeIntoCurrentImpl);
export const updateFromUpstream = lockWrite(updateFromUpstreamImpl);
export const push = lockWrite(pushImpl);
export const stageFile = lockWrite(stageFileImpl);
export const discardChanges = lockWrite(discardChangesImpl);
export const discardFiles = lockWrite(discardFilesImpl);
export const discardLines = lockWrite(discardLinesImpl);
export const continueMerge = lockWrite(continueMergeImpl);
export const abortMerge = lockWrite(abortMergeImpl);
export const createManagedStash = lockWrite(createManagedStashImpl);
export const restoreManagedStash = lockWrite(restoreManagedStashImpl);
export const restoreManagedStashKeepingLocal = lockWrite(restoreManagedStashKeepingLocalImpl);
export const discardManagedStash = lockWrite(discardManagedStashImpl);
export const finishStashPop = lockWrite(finishStashPopImpl);
export const abortStashPop = lockWrite(abortStashPopImpl);
export const commit = lockWrite(commitImpl);
export const undoLastCommit = lockWrite(undoLastCommitImpl);
export const checkoutPR = lockWrite(checkoutPRImpl);
export const pinPRBaseRef = lockWrite(pinPRBaseRefImpl);

// The push (or fetch) URL of `origin`, or null when there's no origin remote.
async function originRemoteUrl(git: SimpleGit): Promise<string | null> {
	const remotes = await git.getRemotes(true).catch(() => []);
	const origin = remotes.find((r) => r.name === 'origin');
	return origin?.refs.push ?? origin?.refs.fetch ?? null;
}

// Resolve a `remote` argument — either a configured remote name or a bare URL —
// to the URL we should authenticate against. Unknown names fall through as-is so
// authConfig can decide (a non-URL simply yields no credentials).
async function resolveRemoteUrl(git: SimpleGit, remote: string): Promise<string | null> {
	const remotes = await git.getRemotes(true).catch(() => []);
	const named = remotes.find((r) => r.name === remote);
	if (named) return named.refs.push ?? named.refs.fetch ?? null;
	return remote;
}

export function repoIdFromPath(p: string): string {
	return createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 12);
}

export async function isGitRepo(dirPath: string): Promise<boolean> {
	try {
		const git = openGit(dirPath);
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

// How brand-representative an icon's *name* is, ranked best → worst (lower
// wins). Real repos rarely stop at `favicon.svg` — they ship the whole
// realfavicongenerator / PWA set: `apple-touch-icon.png`,
// `android-chrome-512x512.png`, `favicon-32x32.png`, `favicon-dark.ico`, … so
// we recognize those conventional names too. Otherwise a repo whose only exact
// `favicon.*` is an un-customized placeholder never reaches its real mark.
// `app-icon`/`AppIcon` cover macOS bundles. Note: `og.png`/`opengraph-image.*`
// are social cards, not icons, and are deliberately NOT matched here.
const ICON_RANK_FAVICON = 0; // canonical favicon.{svg,png,ico}
const ICON_RANK_APPLE_TOUCH = 1; // apple-touch-icon — full brand mark, hi-res
const ICON_RANK_PWA = 2; // android-chrome-*, icon-*, maskable, app-icon
const ICON_RANK_FAVICON_VARIANT = 3; // favicon-32x32, favicon-dark, … (downscaled/themed)
const ICON_RANK_LOGO = 4; // logo, logo-dark, *-logo

function iconBaseRank(stem: string): number | undefined {
	if (stem === 'favicon') return ICON_RANK_FAVICON;
	if (stem === 'apple-touch-icon' || stem.startsWith('apple-touch-icon-'))
		return ICON_RANK_APPLE_TOUCH;
	if (
		stem.startsWith('android-chrome') ||
		stem === 'icon' ||
		stem.startsWith('icon-') ||
		stem === 'app-icon' ||
		stem === 'appicon' ||
		stem.startsWith('maskable')
	)
		return ICON_RANK_PWA;
	if (stem.startsWith('favicon-') || stem.startsWith('favicon_')) return ICON_RANK_FAVICON_VARIANT;
	if (
		stem === 'logo' ||
		stem.startsWith('logo-') ||
		stem.startsWith('logo_') ||
		stem.endsWith('-logo') ||
		stem.endsWith('_logo')
	)
		return ICON_RANK_LOGO;
	return undefined;
}
const ICON_EXT_PRIORITY: Record<string, number> = {
	svg: 0,
	png: 1,
	ico: 2
};
// Content hashes (md5) of well-known starter-template icons that ship
// unmodified in countless repos — the grey SvelteKit skeleton favicon, etc.
// They score highest (a root `favicon.png` beats a `logo.svg`) but rarely
// represent the project's brand. When the best candidate's bytes match one of
// these we skip past it to the next candidate (usually the real `logo.svg`),
// falling back to the generic icon only if nothing else turns up.
const GENERIC_ICON_HASHES = new Set([
	// SvelteKit skeleton `favicon.png` — the grey Svelte logo, 128×128, 1571 bytes.
	'3a387408ecc6cc283f724b39ca5fffb4',
	// SvelteKit skeleton `favicon.svg` — the orange (#ff3e00) Svelte logo, 1569 bytes.
	'a0d1b540c1b9a2a920d5f6cae983118a'
]);
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
	'.storybook',
	// Scaffolding the repo *ships* (starter templates, boilerplates). Their
	// favicons are stock placeholders, not the project's own brand — so a repo's
	// real icon in `apps/web/` should outrank a `favicon.svg` in `templates/`.
	'template',
	'templates',
	'starter',
	'starters',
	'boilerplate',
	'scaffold'
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

// Turn a validated icon file's bytes into a `data:` URL for an <img> src.
function iconBufferToDataUrl(buf: Buffer, filePath: string): string {
	const ext = path.extname(filePath).slice(1).toLowerCase();
	const mime =
		ext === 'svg'
			? 'image/svg+xml'
			: ext === 'png'
				? 'image/png'
				: ext === 'ico'
					? 'image/x-icon'
					: `image/${ext}`;
	return `data:${mime};base64,${buf.toString('base64')}`;
}

// A repo icon resolved to its theme variants. `iconDataUrl` is always set (the
// light/default icon); `iconDataUrlDark` only when a distinct dark variant
// exists. Mirrors the same-named fields on RepoInfo.
interface ResolvedIcon {
	iconDataUrl: string;
	iconDataUrlDark?: string;
}

// Pulls a trailing `-dark`/`-light` (or `_dark`/`_light`) theme marker off an
// icon's stem. `favicon-dark` → { base: 'favicon', sep: '-', theme: 'dark' }.
function parseThemeSuffix(
	stem: string
): { base: string; sep: string; theme: 'light' | 'dark' } | undefined {
	const m = stem.match(/^(.+)([-_])(dark|light)$/);
	if (!m) return undefined;
	return { base: m[1], sep: m[2], theme: m[3] as 'light' | 'dark' };
}

// Given the chosen icon, see if it's half of a light/dark pair and, if so, find
// its sibling so the UI can swap by theme. `favicon-dark.svg` looks for
// `favicon-light.svg` in the same dir (preferring the same extension). Maps both
// to light(default)/dark regardless of which side scored as the winner.
async function resolveIconPair(winnerPath: string, winnerBuf: Buffer): Promise<ResolvedIcon> {
	const winnerUrl = iconBufferToDataUrl(winnerBuf, winnerPath);
	const winnerExt = path.extname(winnerPath).slice(1).toLowerCase();
	const stem = winnerPath
		.slice(0, winnerPath.length - winnerExt.length - 1)
		.split(path.sep)
		.pop()!
		.toLowerCase();
	const parsed = parseThemeSuffix(stem);
	if (!parsed) return { iconDataUrl: winnerUrl };

	const opposite = parsed.theme === 'dark' ? 'light' : 'dark';
	const wantStem = `${parsed.base}${parsed.sep}${opposite}`;
	const dir = path.dirname(winnerPath);
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return { iconDataUrl: winnerUrl };
	}
	const siblings = entries
		.filter((e) => e.isFile())
		.map((e) => {
			const ext = path.extname(e.name).slice(1).toLowerCase();
			return {
				name: e.name,
				ext,
				stem: e.name.slice(0, e.name.length - ext.length - 1).toLowerCase()
			};
		})
		.filter((c) => ICON_EXT_PRIORITY[c.ext] !== undefined && c.stem === wantStem)
		// Prefer the same extension as the winner, then svg > png > ico.
		.sort(
			(a, b) =>
				(a.ext === winnerExt ? 0 : 1) - (b.ext === winnerExt ? 0 : 1) ||
				ICON_EXT_PRIORITY[a.ext] - ICON_EXT_PRIORITY[b.ext]
		);
	if (siblings.length === 0) return { iconDataUrl: winnerUrl };

	const sibPath = path.join(dir, siblings[0].name);
	let sibBuf;
	try {
		sibBuf = await fs.readFile(sibPath);
	} catch {
		return { iconDataUrl: winnerUrl };
	}
	if (sibBuf.byteLength === 0 || sibBuf.byteLength > 256 * 1024) return { iconDataUrl: winnerUrl };
	const sibUrl = iconBufferToDataUrl(sibBuf, sibPath);
	return parsed.theme === 'dark'
		? { iconDataUrl: sibUrl, iconDataUrlDark: winnerUrl }
		: { iconDataUrl: winnerUrl, iconDataUrlDark: sibUrl };
}

// Walk the repo up to MAX_DEPTH collecting every candidate icon, then pick the
// best by score. Bounded because monorepos can have thousands of subdirs and we
// don't want to stall the picker — but we can't short-circuit on the top score
// anymore, because the best-scoring candidate may turn out to be a generic
// starter-template icon (see GENERIC_ICON_HASHES) that we want to skip past.
async function findRepoIcon(repoPath: string): Promise<ResolvedIcon | undefined> {
	const MAX_DEPTH = 5;
	const candidates: Array<{
		path: string;
		score: number;
		baseRank: number;
		pairKey?: string;
		theme?: 'light' | 'dark';
	}> = [];

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
			candidates.push({ path: elIcon, score, baseRank: 0 });
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
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).slice(1).toLowerCase();
				const extPriority = ICON_EXT_PRIORITY[ext];
				if (extPriority === undefined) continue;
				const stem = entry.name.slice(0, entry.name.length - ext.length - 1).toLowerCase();
				const basePriority = iconBaseRank(stem);
				if (basePriority === undefined) continue;
				// Depth penalty so top-level files beat deeply nested ones at the
				// same base/ext rank, but a `favicon.svg` 4 levels deep still wins
				// over a `logo.png` at the root. Non-canonical paths (examples/,
				// tests/, fixtures/) take a large penalty so the brand favicon
				// outranks starter-template icons.
				const score = basePriority * 100 + extPriority * 10 + depth + (nonCanonical ? 500 : 0);
				// Note light/dark members so a complete pair can be boosted below.
				// `favicon-dark` / `favicon-light` in the same dir share a pairKey.
				const parsed = parseThemeSuffix(stem);
				const pairKey = parsed ? `${dir}\x00${parsed.base}${parsed.sep}` : undefined;
				candidates.push({
					path: path.join(dir, entry.name),
					score,
					baseRank: basePriority,
					pairKey,
					theme: parsed?.theme
				});
			}
		}
	}

	await visit(repoPath, 0, false);
	if (candidates.length === 0) return undefined;

	// A directory holding *both* a `favicon-dark` and a `favicon-light` is the
	// site's real favicon split by theme — the author made it precisely so the
	// icon adapts. Promote such a pair to canonical favicon rank so it beats a
	// single `apple-touch-icon` that would otherwise be black-on-transparent and
	// vanish in dark mode (e.g. projektr). We deliberately do NOT promote `logo-*`
	// or other pairs: a themed logo shouldn't outrank a repo's actual favicon
	// (e.g. runed ships a stale `logo-dark/light.svg` in its docs).
	const themesByKey = new Map<string, Set<string>>();
	for (const c of candidates) {
		if (!c.pairKey || !c.theme) continue;
		const set = themesByKey.get(c.pairKey) ?? new Set<string>();
		set.add(c.theme);
		themesByKey.set(c.pairKey, set);
	}
	const isThemedFaviconPair = (c: (typeof candidates)[number]) =>
		c.baseRank === ICON_RANK_FAVICON_VARIANT &&
		c.pairKey !== undefined &&
		themesByKey.get(c.pairKey)?.size === 2;
	const effectiveScore = (c: (typeof candidates)[number]) =>
		isThemedFaviconPair(c) ? c.score - ICON_RANK_FAVICON_VARIANT * 100 : c.score;
	candidates.sort((a, b) => effectiveScore(a) - effectiveScore(b));

	// Walk best → worst, reading bytes lazily. Use the first candidate whose
	// content isn't a known starter-template icon; remember the best generic one
	// as a fallback so a repo that only has the stock favicon still gets it.
	let fallback: string | undefined;
	for (const { path: candidatePath } of candidates) {
		let buf;
		try {
			buf = await fs.readFile(candidatePath);
		} catch {
			continue;
		}
		if (buf.byteLength === 0 || buf.byteLength > 256 * 1024) continue;
		const hash = createHash('md5').update(buf).digest('hex');
		if (GENERIC_ICON_HASHES.has(hash)) {
			fallback ??= iconBufferToDataUrl(buf, candidatePath);
			continue;
		}
		return resolveIconPair(candidatePath, buf);
	}
	// Only a generic placeholder turned up — show it, but it has no theme variant.
	return fallback ? { iconDataUrl: fallback } : undefined;
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

// Resolve the GitHub `owner`/`repo` for a repo from one of its remotes
// (`origin` by default), or null when that remote is missing or isn't a
// github.com URL. Thin public wrapper over the remote lookup + URL parsing the
// desktop app does in `buildRepoInfo`, for callers (like the CLI) that only need
// the slug.
export async function resolveGithubRepo(
	repoPath: string,
	remote = 'origin'
): Promise<{ owner: string; repo: string } | null> {
	const git = openGit(repoPath);
	const remotes = await git.getRemotes(true).catch(() => []);
	const named = remotes.find((r) => r.name === remote) ?? remotes.find((r) => r.name === 'origin');
	const url = named?.refs.fetch ?? named?.refs.push;
	if (!url) return null;
	return (await parseGithubFromUrl(url)) ?? null;
}

export async function buildRepoInfo(repoPath: string): Promise<RepoInfo> {
	const git = openGit(repoPath);
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
	const icon = await findRepoIcon(repoPath);
	const description = await readRepoDescription(repoPath);
	return {
		id,
		path: path.resolve(repoPath),
		name,
		iconDataUrl: icon?.iconDataUrl,
		iconDataUrlDark: icon?.iconDataUrlDark,
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
	const git = openGit(repoPath);
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

// List local branches that no longer live on any remote — the cleanup
// candidates for "Clean Up Local Branches". A branch qualifies when it tracks
// nothing (`%(upstream:short)` is empty) or its tracking ref is gone
// (`%(upstream:track)` reports "[gone]", i.e. the remote branch was deleted and
// pruned — the usual state after a PR merges). A branch with a live upstream is
// still on the remote, so it's never offered. The checked-out branch is always
// excluded: git refuses to delete it. Each candidate carries how many stashes
// were created on it so the UI can warn before deleting parked work.
export async function listLocalOnlyBranches(repoPath: string): Promise<LocalOnlyBranch[]> {
	const git = openGit(repoPath);
	const [currentRaw, raw, stashRaw] = await Promise.all([
		git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
		git.raw([
			'for-each-ref',
			'--format=%(refname:short)\t%(committerdate:unix)\t%(upstream:short)\t%(upstream:track)',
			'refs/heads'
		]),
		git.raw(['stash', 'list', '--format=%gs']).catch(() => '')
	]);
	const current = currentRaw.trim();

	// Tally stashes per branch from their reflog subjects. Git writes either
	// "WIP on <branch>: …" (its auto message) or "On <branch>: …" (a custom `-m`
	// message — what our managed stashes use), so one pattern covers both. A
	// refname can't contain a colon, so the first ":" always ends the branch.
	const stashCounts = new Map<string, number>();
	for (const line of stashRaw.split('\n')) {
		const m = /^(?:WIP on|On) (.+?):/.exec(line.trim());
		if (!m) continue;
		stashCounts.set(m[1], (stashCounts.get(m[1]) ?? 0) + 1);
	}

	const branches: LocalOnlyBranch[] = [];
	for (const line of raw.split('\n').filter(Boolean)) {
		const [name, tsRaw, upstream, track] = line.split('\t');
		if (!name || name === current) continue;
		// `%(upstream:track)` is empty for an in-sync branch and "[gone]" once the
		// remote branch is deleted, so a branch is local-only when it tracks
		// nothing or its tracking ref is gone.
		const gone = (track ?? '').includes('gone');
		if (upstream && !gone) continue;
		const ts = Number(tsRaw);
		branches.push({
			name,
			lastCommitAt: Number.isFinite(ts) && ts > 0 ? ts * 1000 : undefined,
			goneUpstream: gone ? upstream : undefined,
			stashCount: stashCounts.get(name) ?? 0
		});
	}
	// Most recently updated first, like the branch picker.
	branches.sort((a, b) => {
		const at = a.lastCommitAt ?? 0;
		const bt = b.lastCommitAt ?? 0;
		if (at !== bt) return bt - at;
		return a.name.localeCompare(b.name);
	});
	return branches;
}

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
	const git = openGit(repoPath);
	try {
		const status = await git.status();
		return status.current ?? null;
	} catch {
		return null;
	}
}

async function checkoutImpl(repoPath: string, branch: string): Promise<void> {
	const git = openGit(repoPath);
	await git.checkout(branch);
}

export async function isWorkingTreeDirty(repoPath: string): Promise<boolean> {
	try {
		const status = await openGit(repoPath).status();
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
async function createBranchImpl(
	repoPath: string,
	name: string,
	opts: { base?: string; checkout: boolean }
): Promise<CreateBranchResult> {
	const trimmed = name.trim();
	if (!trimmed) return { ok: false, error: 'Branch name is required.' };
	const git = openGit(repoPath);
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
async function deleteBranchImpl(
	repoPath: string,
	name: string,
	opts: { deleteRemote: boolean; upstream?: string }
): Promise<DeleteBranchResult> {
	const trimmed = name.trim();
	if (!trimmed) return { ok: false, error: 'Branch name is required.' };
	const git = openGit(repoPath);
	try {
		await git.raw(['branch', '-D', trimmed]);
		if (opts.deleteRemote && opts.upstream) {
			const slash = opts.upstream.indexOf('/');
			if (slash > 0) {
				const remote = opts.upstream.slice(0, slash);
				const ref = opts.upstream.slice(slash + 1);
				const remoteUrl = await resolveRemoteUrl(git, remote);
				await authedGit(repoPath, remoteUrl).push([remote, '--delete', ref]);
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
			// Prefer origin/<base> so the diff matches GitHub even when the local
			// default branch is behind the remote (head stays as-is — it's the
			// branch/PR-head being reviewed).
			return { base: await preferRemoteBase(git, ctx.base), head: ctx.head, workingTree: false };
		case 'pr':
			return {
				base: `pr/${ctx.prNumber}/base`,
				head: `pr/${ctx.prNumber}/head`,
				workingTree: false
			};
		case 'commit': {
			// A single commit's diff is the commit against its first parent. base...head
			// is three-dot, but for a commit vs its own parent the merge-base IS the
			// parent, so it equals the two-dot diff — reusing the branch machinery
			// gives exactly `git show <ref>`. A root commit has no parent; we point the
			// base at the empty tree, which the base/head paths treat as "no common
			// base" and surface as no changes (rare enough not to special-case).
			const parent = `${ctx.ref}^`;
			const hasParent = await revExists(git, parent);
			return { base: hasParent ? parent : EMPTY_TREE, head: ctx.ref, workingTree: false };
		}
		case 'session':
			// Sessions are frozen snapshots served from disk by the IPC layer; they
			// never reach git-service. Guard the invariant rather than guess a ref.
			throw new Error('session context is not backed by git');
		case 'stash':
			// Stash diffs don't fit the base/head shape (they fan out across the
			// commit's `^1`/`^2`/`^3` parents), so listChangedFiles / getDiff handle
			// the stash kind in dedicated branches before reaching here.
			throw new Error('stash context is handled by dedicated branches');
	}
	void git;
}

// Whether `ref` resolves to a commit. A freshly-created repo (or any branch
// with no commits yet) has no resolvable refs, so a base...head diff against it
// throws "unknown revision"; callers use this to treat that as "no changes".
//
// `--quiet` makes git exit 1 with empty output for an unknown ref, and this
// simple-git build resolves that as "" rather than throwing — so we can't rely
// on the catch alone. A resolvable ref prints its SHA, so require non-empty
// output. (Without this, an absent ref like `origin/main` in a remote-less repo
// reads as existing, and preferRemoteBase rewrites the base to a ref git can't
// resolve.)
async function revExists(git: SimpleGit, ref: string): Promise<boolean> {
	try {
		const out = await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
		return out.trim().length > 0;
	} catch {
		return false;
	}
}

// Resolve a ref to its full commit SHA, or null if it doesn't resolve. Used to
// anchor a PR review comment to the exact commit the on-screen diff was rendered
// from (the local `pr/<n>/head` snapshot), so the comment's line/side match what
// the user is looking at rather than a possibly-newer live head.
export async function resolveRef(repoPath: string, ref: string): Promise<string | null> {
	const git = openGit(repoPath);
	try {
		const out = await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
		const sha = out.trim();
		return sha.length > 0 ? sha : null;
	} catch {
		return null;
	}
}

// Whether a ref resolves to a commit in this repo. Used on a cold start to
// confirm a remembered branch base (a `pr/<n>/base` ref fetched in a prior
// session) still exists locally before the diff targets it.
export async function refExists(repoPath: string, ref: string): Promise<boolean> {
	return (await resolveRef(repoPath, ref)) !== null;
}

// Resolve a branch-diff base to its remote-tracking copy when one exists, so the
// comparison uses the up-to-date remote tip (`origin/main`) — matching how
// GitHub computes a PR/branch diff — instead of a possibly-stale local default
// branch, which would surface every commit merged to the real default since the
// user last updated their local copy. Falls back to the given ref (a local-only
// repo, or a base that has no remote-tracking ref).
async function preferRemoteBase(git: SimpleGit, base: string): Promise<string> {
	if (base.startsWith('origin/')) return base;
	const remote = `origin/${base}`;
	return (await revExists(git, remote)) ? remote : base;
}

export async function listChangedFiles(repoPath: string, ctx: DiffContext): Promise<ChangedFile[]> {
	const git = openGit(repoPath);

	// Stash diffs fan out across the stash commit's parents, so they don't go
	// through refsForContext's base/head model. Tracked changes come from
	// `<ref>^1 → <ref>`; untracked files (captured with --include-untracked) live
	// in the standalone `^3` tree and are reported as additions.
	if (ctx.kind === 'stash') {
		const ref = ctx.ref;
		const stashFiles: ChangedFile[] = [];
		if (!(await revExists(git, ref))) return stashFiles;

		const nameStatus = await git
			.raw(['diff', '--name-status', '--find-renames', `${ref}^1`, ref])
			.catch(() => '');
		const numstatRaw = await git.raw(['diff', '--numstat', `${ref}^1`, ref]).catch(() => '');
		const numstatMap = parseNumstat(numstatRaw);
		const oidMap = parseRawOids(
			await git
				.raw(['diff', '--raw', '--no-abbrev', '--find-renames', `${ref}^1`, ref])
				.catch(() => '')
		);
		for (const line of nameStatus.split('\n').filter(Boolean)) {
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
			const ns = numstatMap.get(p) ?? { additions: 0, deletions: 0, binary: false };
			stashFiles.push({
				path: p,
				oldPath,
				status,
				additions: ns.additions,
				deletions: ns.deletions,
				isBinary: ns.binary,
				contentSig: oidMap.get(p)?.dst,
				baseContentSig: oidMap.get(p)?.base
			});
		}

		// Untracked files: the `^3` tree exists only when the stash was created
		// with --include-untracked. Diff it against the empty tree so every entry
		// shows up as an addition.
		if (await revExists(git, `${ref}^3`)) {
			const untrackedNumstat = await git
				.raw(['diff', '--numstat', EMPTY_TREE, `${ref}^3`])
				.catch(() => '');
			const untrackedMap = parseNumstat(untrackedNumstat);
			const untrackedOids = parseRawOids(
				await git.raw(['diff', '--raw', '--no-abbrev', EMPTY_TREE, `${ref}^3`]).catch(() => '')
			);
			for (const [p, ns] of untrackedMap) {
				stashFiles.push({
					path: p,
					status: 'added',
					additions: ns.additions,
					deletions: ns.deletions,
					isBinary: ns.binary,
					contentSig: untrackedOids.get(p)?.dst,
					baseContentSig: untrackedOids.get(p)?.base
				});
			}
		}
		return stashFiles;
	}

	const refs = await refsForContext(git, ctx);
	const files: ChangedFile[] = [];

	if (refs.workingTree) {
		// One git status + one git diff --numstat HEAD covers every tracked
		// change (staged + unstaged). Calling numstat per-file was the dominant
		// cost: each git subprocess spawn is ~30-100ms on macOS, so a repo with
		// 30 changed files paid 1-3s just for numstats. Untracked files aren't
		// included in `diff HEAD`; we count those from disk in parallel below.
		// The full `diff HEAD` patch rides along (one more subprocess) purely for
		// its per-file `index` lines: unlike `--raw`, the patch makes git hash the
		// working-tree blob, giving a content signature that moves on any real edit
		// — even one that keeps the same +/- counts. Untracked files aren't in it;
		// we hash those from disk alongside the line count below.
		const [status, numstatRaw, patchRaw] = await Promise.all([
			git.status(),
			git.raw(['diff', '--numstat', 'HEAD']).catch(() => ''),
			git.raw(['diff', '--full-index', '--find-renames', 'HEAD']).catch(() => '')
		]);
		const numstatMap = parseNumstat(numstatRaw);
		const oidMap = parsePatchOids(patchRaw);
		const untrackedReadTasks: Array<{ index: number; filePath: string }> = [];

		for (const f of status.files) {
			const fullStatus = mapStatus(f.index, f.working_dir);
			let oldPath: string | undefined;
			let p = f.path;
			// simple-git surfaces a staged rename as `{ path: <new>, from: <old> }`
			// — not the legacy `"<old> -> <new>"` string. Prefer the structured
			// `from`; without it the rename's old side is dropped, so the commit
			// stages only the new path and leaves the old path's staged deletion
			// behind as an orphan that can never be committed (its pathspec no
			// longer matches anything once the rename lands). Keep the ` -> ` regex
			// as a fallback for any code path that still produces that format.
			if (f.from) {
				oldPath = f.from;
			} else {
				const renameMatch = f.path.match(/^(.+) -> (.+)$/);
				if (renameMatch) {
					oldPath = renameMatch[1];
					p = renameMatch[2];
				}
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
				isBinary: ns.binary,
				contentSig: oidMap.get(p)?.dst,
				baseContentSig: oidMap.get(p)?.base
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
							isBinary: counted.binary,
							contentSig: counted.sig ?? files[index].contentSig
							// An untracked file has no old side, so baseContentSig stays
							// undefined and its diff identity rests on the content alone.
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
		const [baseExists, headExists] = await Promise.all([
			revExists(git, refs.base),
			revExists(git, refs.head)
		]);
		if (!baseExists || !headExists) {
			return files;
		}
		// The name-status, numstat, and raw passes are independent — run them
		// together so the switch into a branch/PR view waits on one round-trip, not
		// three. The `--raw` pass carries the destination blob OID per file, which
		// becomes the content signature used to resurface seen files that changed.
		const [raw, numstatRaw, rawOidsRaw] = await Promise.all([
			git.raw(['diff', '--name-status', '--find-renames', `${refs.base}...${refs.head}`]),
			git.raw(['diff', '--numstat', `${refs.base}...${refs.head}`]),
			git
				.raw(['diff', '--raw', '--no-abbrev', '--find-renames', `${refs.base}...${refs.head}`])
				.catch(() => '')
		]);
		const numstatMap = parseNumstat(numstatRaw);
		const oidMap = parseRawOids(rawOidsRaw);

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
				isBinary: ns.binary,
				contentSig: oidMap.get(p)?.dst,
				baseContentSig: oidMap.get(p)?.base
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

// A file's blob OIDs on both sides of a diff. `dst` is the new content's hash;
// `base` is the old content's hash, absent when there is no old side (an added
// file, whose old blob is the all-zero sha). Together they identify the diff
// itself — two files with the same (base, dst) pair produce a byte-identical
// patch — which is what lets a "seen" mark carry across contexts.
interface DiffOids {
	dst: string;
	base?: string;
}

// Drop git's all-zero sha sentinel (an unhashed or empty side) to undefined.
function realOid(sha: string | undefined): string | undefined {
	return sha && !/^0+$/.test(sha) ? sha : undefined;
}

// Map each changed file's path to its blob OIDs, parsed from `git diff --raw`
// output. Lines look like:
//   :100644 100644 <srcsha> <dstsha> M\tpath
//   :100644 100644 <srcsha> <dstsha> R100\toldpath\tnewpath
// The OID is git's content hash, so it differs whenever the file's content
// differs — even an edit that keeps the same +/- counts. An all-zero dst sha
// means git didn't hash that side (a worktree blob under --raw); skip it so the
// caller falls back to the stat signature.
//
// The callers MUST pass `--no-abbrev`: git abbreviates these OIDs to the
// shortest unique prefix by default, and that length grows as the repo gains
// objects (e.g. after a commit). Since the OID is persisted as a seen-file
// signature, an abbreviation that lengthens between sessions would read as "the
// file changed" and silently clear every seen mark. Full OIDs are stable.
function parseRawOids(raw: string): Map<string, DiffOids> {
	const map = new Map<string, DiffOids>();
	for (const line of raw.split('\n').filter(Boolean)) {
		const tabIdx = line.indexOf('\t');
		if (tabIdx === -1) continue;
		const meta = line.slice(0, tabIdx).split(' ');
		const dst = realOid(meta[3]);
		if (!dst) continue;
		const paths = line.slice(tabIdx + 1).split('\t');
		const p = paths[paths.length - 1];
		map.set(p, { dst, base: realOid(meta[2]) });
	}
	return map;
}

// Map each file's path to its blob OIDs, parsed from a full `git diff` patch.
// Unlike `--raw`, the patch makes git hash the working-tree content, so the
// `index <src>..<dst>` line carries a real dst OID even for unstaged edits — the
// only batched way to get a content signature for the working tree. Pure renames
// (100% similar) have no index line and are simply absent, so the caller falls
// back to the stat signature for them.
//
// The caller MUST pass `--full-index`: the `index` line abbreviates both OIDs by
// default, to a length that grows with the repo's object count. Persisting an
// abbreviated OID as a seen signature means a later session reading a longer
// abbreviation sees a "change" and clears the mark — see parseRawOids.
function parsePatchOids(patch: string): Map<string, DiffOids> {
	const map = new Map<string, DiffOids>();
	let currentPath: string | undefined;
	for (const line of patch.split('\n')) {
		if (line.startsWith('diff --git ')) {
			const bIdx = line.indexOf(' b/');
			currentPath = bIdx === -1 ? undefined : line.slice(bIdx + 3);
		} else if (currentPath && line.startsWith('index ')) {
			const m = line.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/);
			const dst = realOid(m?.[2]);
			if (dst) map.set(currentPath, { dst, base: realOid(m?.[1]) });
		}
	}
	return map;
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
// (untracked files, fresh adds). Also returns a content signature (sha1 of the
// bytes) so untracked files, which never reach `git diff`, still resurface when
// edited; oversized files fall back to a size-based signature.
async function countWorkingLines(
	repoPath: string,
	filePath: string
): Promise<{ additions: number; binary: boolean; sig?: string } | null> {
	try {
		const abs = path.join(repoPath, filePath);
		const stat = await fs.stat(abs);
		if (!stat.isFile()) return null;
		if (stat.size === 0) return { additions: 0, binary: false, sig: 'empty' };
		if (stat.size > MAX_FILE_BYTES)
			return { additions: 0, binary: false, sig: `size:${stat.size}` };
		const buf = await fs.readFile(abs);
		const sig = createHash('sha1').update(buf).digest('hex');
		const probeEnd = Math.min(buf.length, 8192);
		for (let i = 0; i < probeEnd; i++) {
			if (buf[i] === 0) return { additions: 0, binary: true, sig };
		}
		let lines = 0;
		for (let i = 0; i < buf.length; i++) {
			if (buf[i] === 0x0a) lines++;
		}
		if (buf[buf.length - 1] !== 0x0a) lines++;
		return { additions: lines, binary: false, sig };
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

// One file's diff inside a managed stash. Tracked changes diff `<ref>^1 → <ref>`
// (old from `^1`, new from the stash tree); untracked files live in the
// standalone `^3` tree and reuse the synthesized added-file patch, exactly like
// the working-tree untracked path. Resolved against the stash commit's SHA, so
// it's immune to index shifts.
async function getStashDiff(repoPath: string, filePath: string, ref: string): Promise<DiffData> {
	const git = openGit(repoPath);
	const hasUntracked = await revExists(git, `${ref}^3`);
	const isUntracked =
		hasUntracked &&
		(await git
			.raw(['cat-file', '-e', `${ref}^3:${filePath}`])
			.then(() => true)
			.catch(() => false));

	const oldRef = isUntracked ? undefined : `${ref}^1`;
	const newRef = isUntracked ? `${ref}^3` : ref;

	let patch = '';
	let oldContents = oldRef ? await showFile(git, oldRef, filePath) : '';
	let newContents = await showFile(git, newRef, filePath);

	const numstatRaw = isUntracked
		? await git.raw(['diff', '--numstat', EMPTY_TREE, `${ref}^3`, '--', filePath]).catch(() => '')
		: await git.raw(['diff', '--numstat', `${ref}^1`, ref, '--', filePath]).catch(() => '');
	const ns = parseNumstat(numstatRaw).get(filePath) ?? {
		additions: 0,
		deletions: 0,
		binary: false
	};
	const isBinary = ns.binary;

	// Tracked files diff against the stash's HEAD parent; untracked files have no
	// parent to diff, so `patch` stays empty here and is synthesized below.
	if (!isUntracked) {
		patch = await git.raw(['diff', `${ref}^1`, ref, '--', filePath]).catch(() => '');
	}

	const imageMime = imageMimeForPath(filePath);
	let oldImage: string | undefined;
	let newImage: string | undefined;
	if (imageMime) {
		({ oldImage, newImage } = await imageDataUrls(repoPath, filePath, imageMime, oldRef, newRef));
	}

	const hasOld = oldContents.length > 0 || oldImage !== undefined;
	const hasNew = newContents.length > 0 || newImage !== undefined;
	let status: FileStatus;
	if (hasNew && !hasOld) status = 'added';
	else if (hasOld && !hasNew) status = 'deleted';
	else status = 'modified';

	const truncated = tooLargeToRender(oldContents, newContents);
	const dropTextContents = isBinary && imageMime !== null;

	// Untracked files have no patch from git (they're not against any parent);
	// synthesize an added-file patch so the staging gutters render the same way
	// the working-tree untracked path does.
	if (
		isUntracked &&
		!patch &&
		status === 'added' &&
		!isBinary &&
		imageMime === null &&
		!truncated &&
		newContents
	) {
		patch = synthesizeAddedFilePatch(filePath, newContents);
	}

	if (truncated || dropTextContents) {
		oldContents = '';
		newContents = '';
	}

	return {
		file: {
			path: filePath,
			oldPath: undefined,
			status,
			additions: ns.additions,
			deletions: ns.deletions,
			isBinary
		},
		patch,
		oldContents,
		newContents,
		truncated,
		oldImage,
		newImage
	};
}

export async function getDiff(
	repoPath: string,
	filePath: string,
	ctx: DiffContext
): Promise<DiffData> {
	const git = openGit(repoPath);
	if (ctx.kind === 'stash') return getStashDiff(repoPath, filePath, ctx.ref);
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
		// The patch, both file contents, and the numstat are independent reads —
		// fetch them concurrently so a file's diff is one round-trip deep, not four.
		const [patchOut, oldOut, newOut, ns] = await Promise.all([
			git.raw(['diff', `${refs.base}...${refs.head}`, '--', filePath]).catch(() => ''),
			showFile(git, oldSideRef!, filePath),
			showFile(git, refs.head, filePath),
			safeNumstat(git, refs.base, refs.head, filePath)
		]);
		patch = patchOut;
		oldContents = oldOut;
		newContents = newOut;
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

	const truncated = tooLargeToRender(oldContents, newContents);

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
	return detectDefaultBranch(openGit(repoPath));
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
	const git = openGit(repoPath);
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
	blockedFiles?: string[];
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

// git aborts a pull that would clobber uncommitted local edits with "Your local
// changes to the following files would be overwritten by merge:" followed by a
// tab-indented file list. Recognise that signature and pull out the file list so
// the app can offer to stash instead of surfacing a raw error. Returns null for
// any other error (which falls through to the generic `error` path).
const OVERWRITE_RE =
	/your local changes to the following files would be overwritten by (merge|checkout):/i;
function parseOverwriteBlocked(message: string): string[] | null {
	if (!OVERWRITE_RE.test(message)) return null;
	return message
		.split('\n')
		.filter((l) => l.startsWith('\t'))
		.map((l) => l.slice(1).trimEnd())
		.filter(Boolean);
}

async function pullImpl(repoPath: string): Promise<PullPushResult> {
	const remoteUrl = await originRemoteUrl(openGit(repoPath));
	const git = authedGit(repoPath, remoteUrl);
	try {
		await git.raw(['pull', '--no-rebase', '--no-edit']);
		return { ok: true, conflicts: [] };
	} catch (err) {
		const conflicts = await listUnmergedPaths(git);
		if (conflicts.length > 0) return { ok: false, conflicts };
		// simple-git's GitError.message holds stdout+stderr, so the "would be
		// overwritten" abort lands here. Surface the blocked file list (distinct
		// from unmerged conflicts) so the renderer can prompt to stash + retry.
		const message = err instanceof Error ? err.message : String(err);
		const blockedFiles = parseOverwriteBlocked(message);
		if (blockedFiles && blockedFiles.length > 0) {
			return { ok: false, conflicts: [], blockedFiles };
		}
		return {
			ok: false,
			conflicts: [],
			error: message
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
async function mergeIntoCurrentImpl(repoPath: string, ref: string): Promise<PullPushResult> {
	const git = openGit(repoPath);
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
	await ensureUpstreamRemote(openGit(repoPath), url);
}

// Drop the `upstream` remote if present — when a fork is switched to "for my own
// purposes" it no longer tracks a parent. No-op when there's no upstream remote.
export async function removeUpstreamRemote(repoPath: string): Promise<void> {
	const git = openGit(repoPath);
	const remotes = await git.getRemotes().catch(() => []);
	if (remotes.some((r) => r.name === 'upstream')) {
		await git.removeRemote('upstream');
	}
}

// GitHub Desktop's "Update from upstream/<branch>": for a fork, fetch the parent
// repo's <branch> and merge it into the current branch. Reuses mergeIntoCurrent
// so any conflicts flow through the same dialog as updateFromDefault.
async function updateFromUpstreamImpl(
	repoPath: string,
	upstreamUrl: string,
	branch: string
): Promise<PullPushResult> {
	const git = authedGit(repoPath, upstreamUrl);
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

async function pushImpl(repoPath: string): Promise<PullPushResult> {
	try {
		const status = await getPushStatus(repoPath);
		if (!status.branch) throw new Error('Not on a branch (detached HEAD).');
		if (!status.hasRemote) throw new Error("No 'origin' remote configured.");
		const remoteUrl = await originRemoteUrl(openGit(repoPath));
		const git = authedGit(repoPath, remoteUrl);
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
	return listUnmergedPaths(openGit(repoPath));
}

// Re-scan the given conflict files for leftover conflict markers. Any file that
// no longer has markers is staged (marking it resolved for the merge), so the
// caller doesn't need an explicit "mark resolved" step — editing the file away
// from its markers is enough. Returns the paths that are still unresolved (so
// the UI can show an alert vs. a check per file). We key off `<<<<<<<`/`>>>>>>>`
// rather than `=======` since a row of equals is legitimate Markdown.
export async function recheckConflicts(repoPath: string, files: string[]): Promise<string[]> {
	const git = openGit(repoPath);
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

async function stageFileImpl(repoPath: string, filePath: string): Promise<void> {
	await openGit(repoPath).add([filePath]);
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
async function discardChangesImpl(
	repoPath: string,
	filePath: string,
	oldPath?: string,
	trash?: (absPath: string) => Promise<void>
): Promise<void> {
	await discardFilesImpl(repoPath, [{ path: filePath, oldPath }], trash);
}

// Cap how many paths we hand a single git invocation so a large "discard all"
// can't overflow the OS command-line argument limit (ARG_MAX). Well below any
// real limit; just splits the batch into a handful of commands at worst.
const DISCARD_PATH_BATCH = 500;

// Bulk sibling of discardChanges: revert/trash a whole set of files in a couple
// of batched git commands under one index lock, instead of a reset+checkout per
// file. Tracked files are reset to HEAD; new/untracked files go to `trash` (or
// are removed when no callback is given). Each file's `oldPath` (its pre-rename
// path) is restored too. See discardChangesImpl's doc comment for the rationale.
async function discardFilesImpl(
	repoPath: string,
	files: DiscardTarget[],
	trash?: (absPath: string) => Promise<void>
): Promise<void> {
	const git = openGit(repoPath);
	// Expand renames and dedupe (multi-select can overlap on a shared oldPath).
	const paths = new Set<string>();
	for (const f of files) {
		paths.add(f.path);
		if (f.oldPath && f.oldPath !== f.path) paths.add(f.oldPath);
	}
	if (paths.size === 0) return;
	const all = [...paths];

	// Partition HEAD-tracked (revert) from new/untracked (trash) up front. `reset`
	// never rewrites HEAD, so this membership stays valid across the whole batch.
	const inHead = await Promise.all(all.map((p) => pathExistsInHead(git, p)));
	const tracked = all.filter((_, i) => inHead[i]);
	const untracked = all.filter((_, i) => !inHead[i]);

	// Unstage everything first so a worktree restore (or trash) is never partial.
	for (const batch of chunkPaths(all)) {
		await git.raw(['reset', '-q', 'HEAD', '--', ...batch]).catch(() => {});
	}
	for (const batch of chunkPaths(tracked)) {
		await git.raw(['checkout', 'HEAD', '--', ...batch]);
	}
	for (const rel of untracked) {
		const absPath = path.join(repoPath, rel);
		if (trash) {
			await trash(absPath).catch(() => {});
		} else {
			await fs.rm(absPath, { force: true }).catch(() => {});
		}
	}
}

function chunkPaths(paths: string[]): string[][] {
	const out: string[][] = [];
	for (let i = 0; i < paths.length; i += DISCARD_PATH_BATCH) {
		out.push(paths.slice(i, i + DISCARD_PATH_BATCH));
	}
	return out;
}

// Discard a subset of a file's working-tree changes (a hunk or a single line)
// from the diff's native "Discard" context menu. `patch` is a unified diff built
// renderer-side whose base is the current working tree (see
// diff-staging.buildDiscardPatch); applying it forward removes the discarded
// additions and restores the discarded deletions. We apply to the working tree
// only — never `--cached` or `--index` — so the user's real index is left as
// untouched as partial staging leaves it. Discards stay recoverable: the removed
// lines remain in HEAD's version of the file.
async function discardLinesImpl(repoPath: string, patch: string): Promise<void> {
	const git = openGit(repoPath);
	const gitDir = (await git.raw(['rev-parse', '--absolute-git-dir'])).trim();
	const patchPath = path.join(gitDir, `super-review-discard-${process.pid}-${Date.now()}.patch`);
	const text = patch.endsWith('\n') ? patch : `${patch}\n`;
	try {
		await fs.writeFile(patchPath, text, 'utf8');
		// `--whitespace=nowarn` keeps benign whitespace from aborting the apply,
		// matching commitPartial's scratch-index apply.
		await git.raw(['apply', '--whitespace=nowarn', patchPath]);
	} finally {
		await fs.rm(patchPath, { force: true }).catch(() => {});
	}
}

// Try to wrap up an in-progress merge once the user has resolved conflicts. If
// unmerged paths remain we surface them again. When a merge is in progress we
// create the merge commit (which also re-applies any `--autostash` work, and
// that re-apply can itself conflict — so we re-check). When there's no merge in
// progress, the conflicts came from re-applying autostashed changes after a
// fast-forward: nothing to commit — the resolved work stays uncommitted and we
// just clear the backup stash git kept.
async function continueMergeImpl(repoPath: string): Promise<PullPushResult> {
	const git = openGit(repoPath);
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

async function abortMergeImpl(repoPath: string): Promise<void> {
	const git = openGit(repoPath);
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

// --- Managed stashes (GitHub-Desktop parity) --------------------------------
//
// A "managed" stash is a normal git stash whose message carries the marker
// `!!super-review<branch>`, so we only ever touch stashes the app created — never
// the user's own. We keep at most one per branch and create it only when a pull
// is blocked by uncommitted local changes. Every pop/drop/diff resolves
// `stash@{n}` → SHA first: stash indices shift as entries come and go, but the
// commit SHA is stable, so operating on it is race-proof.

// The marker that tags a managed stash for `branch`. Embedding the branch keeps
// one stash per branch and lets us find the right one when several branches each
// have one parked.
function managedStashMarker(branch: string): string {
	return `!!super-review${branch}`;
}

// Create the managed stash for `branch`, capturing untracked files too (they
// land in the stash commit's `^3` tree). "No local changes to save" is a no-op —
// there was simply nothing to stash, so the caller proceeds to the pull.
async function createManagedStashImpl(
	repoPath: string,
	branch: string
): Promise<{ ok: boolean; error?: string }> {
	const git = openGit(repoPath);
	try {
		await git.raw(['stash', 'push', '--include-untracked', '-m', managedStashMarker(branch)]);
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/no local changes to save/i.test(message)) return { ok: true };
		return { ok: false, error: message };
	}
}

// git's well-known empty-tree object. Diffing a single tree against it lists
// every entry in that tree as an addition — how we enumerate the untracked-only
// `^3` tree (which has no parent of its own).
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// Count the files a stash commit captures: tracked changes (`^1` → stash tree)
// plus any untracked files parked in the standalone `^3` tree. Used for the
// sidebar's "N changes" label.
async function countStashFiles(git: SimpleGit, sha: string): Promise<number> {
	const seen = new Set<string>();
	const tracked = await git.raw(['diff', '--name-only', `${sha}^1`, sha]).catch(() => '');
	for (const l of tracked
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean))
		seen.add(l);
	if (await revExists(git, `${sha}^3`)) {
		const untracked = await git
			.raw(['diff', '--name-only', EMPTY_TREE, `${sha}^3`])
			.catch(() => '');
		for (const l of untracked
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean))
			seen.add(l);
	}
	return seen.size;
}

// Resolve a managed stash's commit SHA back to its *current* `stash@{n}`
// reference. `git stash pop`/`drop` only accept a reflog selector (a raw SHA is
// rejected), and the selector's index shifts as entries come and go — so we
// store the stable SHA and re-resolve the live index right before popping or
// dropping. Returns null when no live entry matches the SHA (already gone).
async function resolveStashRef(git: SimpleGit, sha: string): Promise<string | null> {
	const raw = await git.raw(['stash', 'list', '--format=%H %gd']).catch(() => '');
	for (const line of raw
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean)) {
		const sep = line.indexOf(' ');
		if (sep === -1) continue;
		if (line.slice(0, sep) === sha) return line.slice(sep + 1).trim();
	}
	return null;
}

// Find the managed stash for `branch`, resolved to its commit SHA. `git stash
// list` is ordered newest-first and its indices shift as entries are added or
// dropped, so we key on the stable commit SHA (read straight from `%H`). Returns
// null when there is no match; treats >1 match as "none" too (an inconsistent
// state we won't guess at, rather than risk popping the wrong one).
export async function findManagedStash(
	repoPath: string,
	branch: string
): Promise<ManagedStash | null> {
	const git = openGit(repoPath);
	const marker = managedStashMarker(branch);
	const raw = await git.raw(['stash', 'list', '--format=%H %gs']).catch(() => '');
	const shas: string[] = [];
	for (const line of raw
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean)) {
		const sep = line.indexOf(' ');
		if (sep === -1) continue;
		const sha = line.slice(0, sep); // %H
		const subject = line.slice(sep + 1); // %gs (e.g. "On main: !!super-reviewmain")
		if (subject.includes(marker)) shas.push(sha);
	}
	if (shas.length !== 1) return null;
	const fileCount = await countStashFiles(git, shas[0]);
	return { ref: shas[0], fileCount };
}

// Whether `p` exists on disk (file or directory). Mirrors the check git itself
// makes before restoring a stash's untracked files.
async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

// The untracked files a managed stash carries — captured with
// `--include-untracked`, they live in the stash commit's standalone `^3` tree.
// Empty when the stash saved no untracked files (no `^3` parent). Paths are
// repo-relative.
async function stashUntrackedFiles(git: SimpleGit, sha: string): Promise<string[]> {
	if (!(await revExists(git, `${sha}^3`))) return [];
	const raw = await git.raw(['diff', '--name-only', EMPTY_TREE, `${sha}^3`]).catch(() => '');
	return raw
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);
}

// Of the stash's untracked files, the ones that already exist in the working
// tree. `git stash pop`/`apply` aborts wholesale the moment one of them is
// present ("already exists, no checkout") — commonly because the file was
// committed after the stash was taken — applying nothing yet leaving the entry
// stuck. We detect the clash up front rather than let the restore die halfway.
async function collidingStashUntracked(
	repoPath: string,
	git: SimpleGit,
	sha: string
): Promise<string[]> {
	const untracked = await stashUntrackedFiles(git, sha);
	const colliding: string[] = [];
	for (const rel of untracked) {
		if (await pathExists(path.join(repoPath, rel))) colliding.push(rel);
	}
	return colliding;
}

// Restore the managed stash identified by `sha`. We apply (never `pop`) so a
// clean restore is dropped explicitly below while ANY failure leaves the entry
// in place — the stashed work is never lost to a botched restore.
//
// Two failure shapes are handled distinctly:
//   - Untracked collision: files the stash saved already exist in the working
//     tree. `git stash apply` would abort applying nothing, so we detect it up
//     front and hand back the clashing paths in `blockedFiles` (a real, non-fatal
//     signal the renderer can act on), stash untouched. `restoreManagedStashKeepingLocal`
//     is the paired recovery.
//   - Tracked conflict: a conflicted apply exits non-zero, but simple-git
//     RESOLVES rather than throws, so we inspect the index for unmerged paths
//     regardless of how the call returned. The entry stays put for
//     finishStashPop / abortStashPop to wrap up.
// The SHA is re-resolved to its live `stash@{n}` selector before drop, since
// `stash drop` rejects a raw SHA.
async function restoreManagedStashImpl(repoPath: string, sha: string): Promise<PullPushResult> {
	const git = openGit(repoPath);
	const ref = await resolveStashRef(git, sha);
	if (!ref) {
		return { ok: false, conflicts: [], error: 'The stashed changes are no longer available.' };
	}
	const blockedFiles = await collidingStashUntracked(repoPath, git, sha);
	if (blockedFiles.length > 0) {
		return {
			ok: false,
			conflicts: [],
			blockedFiles,
			error: 'Some files this stash saved already exist in your working tree.'
		};
	}
	let applyError: unknown = null;
	try {
		await git.raw(['stash', 'apply', ref]);
	} catch (err) {
		applyError = err;
	}
	const conflicts = await listUnmergedPaths(git);
	if (conflicts.length > 0) return { ok: false, conflicts };
	if (applyError) {
		return {
			ok: false,
			conflicts: [],
			error: applyError instanceof Error ? applyError.message : String(applyError)
		};
	}
	await dropStashBySha(git, sha);
	return { ok: true, conflicts: [] };
}

// Recover from the untracked-collision case (see restoreManagedStash's
// `blockedFiles`): restore everything the stash holds EXCEPT the untracked files
// that already exist — those keep their current working-tree version. We restore
// the stash's non-colliding untracked files from its `^3` tree and apply the
// tracked half as a patch (`git stash apply` can't be used: it would also try to
// restore the colliding untracked files and abort). A tracked-change conflict
// surfaces like any other stash-restore conflict, so finishStashPop /
// abortStashPop finish it; on a clean result the entry is dropped.
async function restoreManagedStashKeepingLocalImpl(
	repoPath: string,
	sha: string
): Promise<PullPushResult> {
	const git = openGit(repoPath);
	const ref = await resolveStashRef(git, sha);
	if (!ref) {
		return { ok: false, conflicts: [], error: 'The stashed changes are no longer available.' };
	}

	// Restore only the untracked files that DON'T already exist, straight from the
	// `^3` tree. checkout writes + stages them; the reset unstages so they land as
	// plain untracked files (stash-pop parity), leaving existing files untouched.
	const untracked = await stashUntrackedFiles(git, sha);
	const toRestore: string[] = [];
	for (const rel of untracked) {
		if (!(await pathExists(path.join(repoPath, rel)))) toRestore.push(rel);
	}
	if (toRestore.length > 0) {
		await git.raw(['checkout', `${sha}^3`, '--', ...toRestore]);
		await git.raw(['reset', '--quiet', '--', ...toRestore]).catch(() => {});
	}

	// Apply the tracked half (`sha^1 → sha`) as a patch. `--3way` reproduces a
	// stash pop's conflict-marker behavior when a hunk overlaps local work.
	const patch = await git.raw(['diff', `${sha}^1`, sha]).catch(() => '');
	let applyError: unknown = null;
	if (patch.trim().length > 0) {
		const patchFile = path.join(os.tmpdir(), `super-review-stash-${sha}.patch`);
		await fs.writeFile(patchFile, patch);
		try {
			await git.raw(['apply', '--3way', patchFile]);
		} catch (err) {
			applyError = err;
		} finally {
			await fs.rm(patchFile, { force: true }).catch(() => {});
		}
	}

	const conflicts = await listUnmergedPaths(git);
	if (conflicts.length > 0) return { ok: false, conflicts };
	if (applyError) {
		return {
			ok: false,
			conflicts: [],
			error: applyError instanceof Error ? applyError.message : String(applyError)
		};
	}
	await dropStashBySha(git, sha);
	return { ok: true, conflicts: [] };
}

// Drop the stash entry for `sha`, re-resolving its live `stash@{n}` selector
// first (a raw SHA is rejected by `stash drop`). No-op if the entry is already
// gone.
async function dropStashBySha(git: SimpleGit, sha: string): Promise<void> {
	const live = await resolveStashRef(git, sha);
	if (live) await git.raw(['stash', 'drop', live]).catch(() => {});
}

// Drop the managed stash by SHA without applying it (GitHub Desktop's "Discard
// Stashed Changes"). Re-resolves the SHA to its live selector first.
async function discardManagedStashImpl(repoPath: string, sha: string): Promise<void> {
	const git = openGit(repoPath);
	const ref = await resolveStashRef(git, sha);
	if (ref) await git.raw(['stash', 'drop', ref]);
}

// Finish a conflicted stash pop once the user has resolved every file. A stash
// pop has no MERGE_HEAD and must NOT create a commit (the resolved work stays in
// the working tree, exactly like the post-fast-forward autostash case), so we do
// not reuse `continueMerge`. We also can't lean on `dropAutostashBackup` — it
// keys off the "autostash" label, not our `!!super-review` marker — so we drop
// the entry explicitly by SHA. If conflicts remain, surface them again.
async function finishStashPopImpl(repoPath: string, sha: string): Promise<PullPushResult> {
	const git = openGit(repoPath);
	const remaining = await listUnmergedPaths(git);
	if (remaining.length > 0) return { ok: false, conflicts: remaining };
	// The conflicted pop left the entry in place; resolve its live selector and
	// drop it now that every path is resolved (a raw SHA is rejected by `drop`).
	const ref = await resolveStashRef(git, sha);
	if (ref) await git.raw(['stash', 'drop', ref]).catch(() => {});
	return { ok: true, conflicts: [] };
}

// Abort a conflicted stash pop: discard the half-applied work from the working
// tree, leaving the managed stash entry intact so nothing is lost. We do NOT
// reuse `abortMerge` — `git merge --abort` is invalid with no merge in progress.
// A conflicted `stash pop` leaves the entry in place, so a plain hard reset is
// enough to recover the pre-restore state.
async function abortStashPopImpl(repoPath: string): Promise<void> {
	const git = openGit(repoPath);
	await git.raw(['checkout', '--', '.']).catch(() => {});
	await git.raw(['reset', '--hard', 'HEAD']).catch(() => {});
}

// Whether a thrown git error is the "pathspec '<x>' did not match any files"
// failure — git's response when a path is absent from both the worktree and the
// index (e.g. a rename's old side once the move is staged as a unit).
function isPathspecMismatch(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return /did not match any file/.test(msg);
}

// ─── Commit signing ─────────────────────────────────────────────────────────
// SSH commit signing needs git >= 2.34 (the `gpg.format=ssh` backend) and an
// ssh-keygen that supports `-Y sign` (OpenSSH >= 8.0). We detect this once and
// cache it; the desktop app gates signing on the result so a user on ancient
// tooling never gets a failed or surprising commit.

let sshSigningSupported: boolean | null = null;

function parseVersion(s: string): [number, number] | null {
	const m = s.match(/(\d+)\.(\d+)/);
	return m ? [Number(m[1]), Number(m[2])] : null;
}

function atLeast(v: [number, number] | null, major: number, minor: number): boolean {
	if (!v) return false;
	return v[0] > major || (v[0] === major && v[1] >= minor);
}

export async function checkSshSigningSupported(): Promise<boolean> {
	if (sshSigningSupported !== null) return sshSigningSupported;
	sshSigningSupported = await (async () => {
		try {
			const { stdout: gitOut } = await execFileAsync('git', ['--version']);
			if (!atLeast(parseVersion(gitOut), 2, 34)) return false;
			// ssh-keygen has no clean version flag; `ssh -V` prints "OpenSSH_X.Y…"
			// (to stderr on most builds, stdout on some). Its absence (ENOENT)
			// throws, which means signing can't work either.
			const { stdout, stderr } = await execFileAsync('ssh', ['-V']);
			const m = (stderr + stdout).match(/OpenSSH[_-](\d+)\.(\d+)/);
			return atLeast(m ? [Number(m[1]), Number(m[2])] : null, 8, 0);
		} catch {
			return false;
		}
	})();
	return sshSigningSupported;
}

// Per-invocation `-c` overrides that turn on SSH signing against the given key,
// without writing anything to the repo's or the user's global git config.
function sshSignConfigArgs(signing: CommitSigning | null | undefined): string[] {
	if (!signing) return [];
	return [
		'-c',
		'gpg.format=ssh',
		'-c',
		`user.signingkey=${signing.keyPath}`,
		'-c',
		'commit.gpgsign=true'
	];
}

// Run a commit-producing git invocation, signing when configured. The callback
// receives the signing `-c` config args and the per-command sign flag (`-S`) to
// splice into its argument list. If a signed attempt fails — missing key,
// unsupported tooling, a flaky ssh-keygen — we retry once unsigned: a signature
// is never worth blocking the commit itself.
async function runSignedOrFallback<T>(
	signing: CommitSigning | null | undefined,
	run: (configArgs: string[], signFlag: string[]) => Promise<T>
): Promise<T> {
	if (!signing) return run([], []);
	try {
		return await run(sshSignConfigArgs(signing), ['-S']);
	} catch {
		return run([], []);
	}
}

// Stages and commits the selected files. Whole-file selections stage the file's
// full working-tree version; partial selections carry a unified diff (HEAD ->
// the kept subset) for line/hunk staging. When nothing is partial we take the
// original fast path (`git add` + a pathspec-pinned `git commit`); otherwise we
// build the commit through a scratch index so only the selected lines land.
async function commitImpl(
	repoPath: string,
	message: string,
	files: CommitFileSelection[],
	identity?: GitIdentity | null,
	signing?: CommitSigning | null
): Promise<CommitResult> {
	const git = openGit(repoPath);
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
			// Stage each path on its own and tolerate an unmatched pathspec. When a
			// rename is already staged as a unit, its old side is gone from both the
			// worktree and the index, so `git add -- <oldPath>` reports "did not
			// match any files" and a single batched add would abort the whole
			// commit. The deletion is already staged in that case, so skipping it is
			// correct; the `git commit -- <paths>` below still records it.
			for (const p of paths) {
				await git.raw(['add', '-A', '--', p]).catch((err) => {
					if (!isPathspecMismatch(err)) throw err;
				});
			}
			// `-c` sets config for this invocation only, overriding both author and
			// committer without touching the repo's git config.
			const identityArgs = identity
				? ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`]
				: [];
			// Pin the commit to the selected pathspecs so anything else that may be
			// staged in the index is left out — only the checked files are committed.
			await runSignedOrFallback(signing, (cfg, sign) =>
				git.raw([...cfg, ...identityArgs, 'commit', ...sign, '-m', trimmed, '--', ...paths])
			);
			return { ok: true, ...(await headCommitStats(git)) };
		}

		await commitPartial(repoPath, trimmed, files, identity, signing);
		return { ok: true, ...(await headCommitStats(git)) };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// File + line counts for the commit now at HEAD (vs its parent, or the empty
// tree for a root commit). Drives the "files/lines committed" usage stats.
// Best-effort: any failure yields zeros rather than failing the commit.
async function headCommitStats(
	git: SimpleGit
): Promise<{ filesCommitted: number; linesCommitted: number }> {
	try {
		const hasParent = await git
			.raw(['rev-parse', '--verify', '--quiet', 'HEAD^'])
			.then(() => true)
			.catch(() => false);
		const range = hasParent ? ['HEAD^', 'HEAD'] : [EMPTY_TREE, 'HEAD'];
		const map = parseNumstat(await git.raw(['diff', '--numstat', ...range]));
		let filesCommitted = 0;
		let linesCommitted = 0;
		for (const row of map.values()) {
			filesCommitted++;
			linesCommitted += row.additions + row.deletions;
		}
		return { filesCommitted, linesCommitted };
	} catch {
		return { filesCommitted: 0, linesCommitted: 0 };
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
	identity?: GitIdentity | null,
	signing?: CommitSigning | null
): Promise<void> {
	const baseGit = openGit(repoPath);
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
	const idxGit = openGit(repoPath).env(indexEnv);

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
		const parentArgs = headExists ? ['-p', 'HEAD'] : [];
		const newSha = (
			await runSignedOrFallback(signing, (cfg, sign) =>
				openGit(repoPath)
					.env(commitEnv)
					.raw([...cfg, 'commit-tree', ...sign, tree, '-m', message, ...parentArgs])
			)
		).trim();

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
	const git = openGit(repoPath);
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

// List commits reachable from `head` (newest first), capped at `limit`, for the
// History tab. Lightweight metadata only — the diff for a commit is fetched
// lazily via a `commit` DiffContext when it's opened. Fields are NUL-ish (unit
// separator) delimited with the subject last so a `%s` that happens to contain a
// separator still parses; records are newline-separated (a `%s` is single-line).
export async function listCommits(
	repoPath: string,
	head = 'HEAD',
	limit = 2000
): Promise<CommitInfo[]> {
	const git = openGit(repoPath);
	try {
		const raw = await git.raw([
			'log',
			`--max-count=${Math.max(1, Math.floor(limit))}`,
			'--pretty=format:%H%h%an%ae%at%s',
			head
		]);
		const commits: CommitInfo[] = [];
		for (const line of raw.split('\n')) {
			if (!line) continue;
			const [hash, shortHash, authorName, authorEmail, at, ...rest] = line.split('');
			if (!hash) continue;
			commits.push({
				hash,
				shortHash,
				authorName,
				authorEmail,
				authoredAt: Number(at) * 1000,
				subject: rest.join('')
			});
		}
		return commits;
	} catch {
		// No commits yet, or an unresolvable head — show an empty history rather
		// than surfacing an error.
		return [];
	}
}

// Merge-base (most-recent common ancestor) of two refs — the point where `b`
// last diverged from `a`. Returns null when the refs share no history or either
// can't be resolved. Backs the History tab's "branched from <base>" divider.
export async function mergeBase(repoPath: string, a: string, b: string): Promise<string | null> {
	const git = openGit(repoPath);
	try {
		const sha = (await git.raw(['merge-base', a, b])).trim();
		return sha || null;
	} catch {
		return null;
	}
}

// Undoes the last commit while keeping its changes staged in the index, the
// same way GitHub Desktop's "Undo" affordance works (git reset --soft HEAD~1).
// When the tip is the repo's only commit, drop the HEAD ref instead so the
// index is preserved.
async function undoLastCommitImpl(repoPath: string): Promise<CommitResult> {
	const git = openGit(repoPath);
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
		await authedGit(null, trimmed).clone(trimmed, target);
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

		const git = openGit(target);
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
	identity?: GitIdentity | null,
	signing?: CommitSigning | null
): Promise<boolean> {
	const git = openGit(repoPath);
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
	await runSignedOrFallback(signing, (cfg, sign) =>
		openGit(repoPath)
			.env(env)
			.raw([...cfg, 'commit', ...sign, '--allow-empty', '-m', message])
	);
	return true;
}

// Point 'origin' at `remoteUrl` and push the current branch, setting it as the
// upstream. Used by the "Publish to GitHub" flow after the remote repo has been
// created via the API. Auth follows the same path as cloneRepo/push: a
// registered credential provider supplies the token per request (see
// authConfig) — we never write a token into the repo config.
export async function setOriginAndPush(
	repoPath: string,
	remoteUrl: string
): Promise<PullPushResult> {
	const git = authedGit(repoPath, remoteUrl);
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
	const git = openGit(repoPath);
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
		const remoteUrl = await originRemoteUrl(openGit(repoPath));
		const git = authedGit(repoPath, remoteUrl);
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
	const base = openGit(repoPath);
	const remoteUrl = await resolveRemoteUrl(base, remote);
	const git = authedGit(repoPath, remoteUrl);
	// Force (`+`) so a rebased/force-pushed PR updates the pinned snapshot instead
	// of leaving a stale ref: `refs/pr/<n>/head` persists across reviews, and a
	// non-forced non-fast-forward update is rejected (and swallowed below). A stale
	// head makes the diff's line numbers disagree with the live head SHA that
	// createReviewComment anchors to — GitHub then rejects comments with
	// "pull_request_review_thread.path could not be resolved".
	await git.fetch([remote, `+pull/${prNumber}/head:refs/pr/${prNumber}/head`]).catch(() => {});
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
async function checkoutPRImpl(repoPath: string, opts: CheckoutPROptions): Promise<void> {
	const git = openGit(repoPath);
	const { prNumber, headRef, headRepoUrl, headRepoOwner } = opts;

	if (!headRepoUrl || !headRepoOwner) {
		const local = await git.branchLocal();
		if (!local.all.includes(headRef)) {
			const fallback = opts.fallbackRemote ?? 'origin';
			const fallbackUrl = await resolveRemoteUrl(git, fallback);
			await authedGit(repoPath, fallbackUrl).fetch([fallback, `pull/${prNumber}/head:${headRef}`]);
		}
		await git.checkout(headRef);
		return;
	}

	const remote = await ensureRemoteForUrl(git, headRepoOwner, headRepoUrl, opts.originUrl);
	await authedGit(repoPath, headRepoUrl).fetch([remote, headRef]);

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

async function pinPRBaseRefImpl(
	repoPath: string,
	prNumber: number,
	baseBranch: string,
	// Remote the base branch lives on — origin for a same-repo PR, or the parent
	// repo's URL for an upstream PR on a fork. See fetchPRRef.
	remote = 'origin'
): Promise<void> {
	const base = openGit(repoPath);
	const remoteUrl = await resolveRemoteUrl(base, remote);
	const git = authedGit(repoPath, remoteUrl);
	// Fetch the base branch's current tip straight into the pinned ref. Writing
	// the refspec directly (rather than fetching a tracking ref then resolving
	// it) means this works whether `remote` is a named remote ("origin") or a
	// bare URL — the latter being what we pass for an upstream PR, whose base
	// repo we don't keep a permanent remote for.
	await git.fetch([remote, `+refs/heads/${baseBranch}:refs/pr/${prNumber}/base`]).catch(() => {});
}
