// Changeset awareness for the desktop app: figure out whether the current
// branch is missing a changeset for a package it changed, and write a new
// changeset file on request.
//
// "Missing a changeset" is judged against the base branch: a package needs one
// when the branch changed it but introduced no changeset covering it. Changesets
// that already existed on the base branch (for other, not-yet-released work)
// don't count — only ones added on this branch (committed or still in the
// working tree) do.
//
// A repo "uses changesets" when it has a `.changeset/config.json`. Releasable
// packages are the workspace packages changesets would version — every
// workspace package except those in `config.ignore` (and private packages only
// when `privatePackages.version` is explicitly `false`; changesets versions
// private packages by default, which is why this repo tracks the private
// `@super-review/desktop`).
//
// This module is Electron-free and mirrors the rest of `@super-review/core`: it
// talks to git via simple-git and reads files with `node:fs`.
import { simpleGit, type SimpleGit } from 'simple-git';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { detectDefaultBranch } from './git-service.js';
import type { ChangesetStatus, CreateChangesetInput, WorkspacePackage } from './types.js';

// Leading `---` … `---` frontmatter block of a changeset file.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

interface ChangesetConfig {
	ignore: string[];
	baseBranch?: string;
	// changesets defaults private-package versioning ON; only an explicit `false`
	// turns it off.
	versionsPrivate: boolean;
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

async function readJson(p: string): Promise<unknown> {
	return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function readChangesetConfig(repoPath: string): Promise<ChangesetConfig | null> {
	const configPath = path.join(repoPath, '.changeset', 'config.json');
	if (!(await pathExists(configPath))) return null;
	try {
		const raw = (await readJson(configPath)) as {
			ignore?: unknown;
			baseBranch?: unknown;
			privatePackages?: { version?: unknown } | false;
		};
		const ignore = Array.isArray(raw.ignore)
			? raw.ignore.filter((x): x is string => typeof x === 'string')
			: [];
		const baseBranch = typeof raw.baseBranch === 'string' ? raw.baseBranch : undefined;
		// `privatePackages: false` disables both versioning and tagging.
		const versionsPrivate =
			raw.privatePackages === false ? false : raw.privatePackages?.version !== false;
		return { ignore, baseBranch, versionsPrivate };
	} catch {
		// A malformed config still means changesets is installed; treat it as the
		// permissive default rather than crashing the status check.
		return { ignore: [], versionsPrivate: true };
	}
}

// --- workspace package discovery ------------------------------------------

// Pull the `packages:` globs out of a pnpm-workspace.yaml without a YAML
// dependency. The file's package list is a flat sequence of quoted strings, so
// we read the list items under the `packages:` key until the indentation drops
// back out of the block.
function parsePnpmWorkspaceGlobs(yaml: string): string[] {
	const lines = yaml.split(/\r?\n/);
	const globs: string[] = [];
	let inPackages = false;
	for (const line of lines) {
		if (/^packages:\s*$/.test(line)) {
			inPackages = true;
			continue;
		}
		if (!inPackages) continue;
		const item = /^\s+-\s+(.*\S)\s*$/.exec(line);
		if (item) {
			globs.push(stripQuotes(item[1]));
			continue;
		}
		// A non-list, non-blank line ends the packages block.
		if (line.trim() !== '') break;
	}
	return globs;
}

function stripQuotes(s: string): string {
	const t = s.trim();
	if (
		t.length >= 2 &&
		((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
	) {
		return t.slice(1, -1);
	}
	return t;
}

async function workspaceGlobs(repoPath: string): Promise<string[]> {
	const pnpm = path.join(repoPath, 'pnpm-workspace.yaml');
	if (await pathExists(pnpm)) {
		const globs = parsePnpmWorkspaceGlobs(await fs.readFile(pnpm, 'utf8'));
		if (globs.length > 0) return globs;
	}
	// Fall back to package.json workspaces (npm/yarn/bun): array or { packages }.
	try {
		const pkg = (await readJson(path.join(repoPath, 'package.json'))) as {
			workspaces?: string[] | { packages?: string[] };
		};
		const ws = pkg.workspaces;
		if (Array.isArray(ws)) return ws;
		if (ws && Array.isArray(ws.packages)) return ws.packages;
	} catch {
		// no root package.json / unreadable — no workspaces.
	}
	return [];
}

// Resolve one workspace glob to directories. Supports the patterns workspaces
// actually use: a literal path, a `*` single-segment wildcard, and `**`
// recursion. Returns repo-relative posix dirs.
async function resolveGlobDirs(repoPath: string, glob: string): Promise<string[]> {
	const segments = glob.split('/').filter((s) => s !== '' && s !== '.');
	let dirs = [''];
	for (const seg of segments) {
		const next: string[] = [];
		for (const dir of dirs) {
			const abs = path.join(repoPath, dir);
			if (seg === '*' || seg === '**') {
				let entries;
				try {
					entries = await fs.readdir(abs, { withFileTypes: true });
				} catch {
					continue;
				}
				for (const e of entries) {
					if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
					const child = dir ? `${dir}/${e.name}` : e.name;
					next.push(child);
					// `**` also matches deeper levels — keep recursing into it.
					if (seg === '**') dirs.push(child);
				}
			} else {
				const child = dir ? `${dir}/${seg}` : seg;
				try {
					if ((await fs.stat(path.join(repoPath, child))).isDirectory()) next.push(child);
				} catch {
					// missing dir — skip.
				}
			}
		}
		dirs = next;
	}
	return dirs;
}

async function listWorkspacePackages(
	repoPath: string,
	config: ChangesetConfig
): Promise<WorkspacePackage[]> {
	const globs = await workspaceGlobs(repoPath);
	const seen = new Set<string>();
	const packages: WorkspacePackage[] = [];
	const ignore = new Set(config.ignore);
	for (const glob of globs) {
		if (glob.startsWith('!')) continue; // negations only ever exclude; rare, skip
		for (const dir of await resolveGlobDirs(repoPath, glob)) {
			if (seen.has(dir)) continue;
			seen.add(dir);
			let pkg: { name?: unknown; private?: unknown };
			try {
				pkg = (await readJson(path.join(repoPath, dir, 'package.json'))) as typeof pkg;
			} catch {
				continue; // not a package dir
			}
			if (typeof pkg.name !== 'string' || !pkg.name) continue;
			const isPrivate = pkg.private === true;
			if (ignore.has(pkg.name)) continue;
			if (isPrivate && !config.versionsPrivate) continue;
			packages.push({ name: pkg.name, dir, private: isPrivate });
		}
	}
	packages.sort((a, b) => a.name.localeCompare(b.name));
	return packages;
}

// --- branch change detection ----------------------------------------------

async function revExists(git: SimpleGit, ref: string): Promise<boolean> {
	try {
		// NB: no `--quiet` — simple-git treats a `--quiet` exit-1 as success, so a
		// missing ref would wrongly resolve. Without it, a missing ref exits 128 and
		// simple-git throws, which is what we want.
		await git.raw(['rev-parse', '--verify', `${ref}^{commit}`]);
		return true;
	} catch {
		return false;
	}
}

// Files changed on this branch: everything that differs from the merge-base with
// the configured/default base (committed-on-branch + uncommitted tracked edits),
// plus untracked files. Falls back to just the working-tree status when there's
// no usable base (detached, no default branch, unborn branch on a fresh repo).
// `added` is the subset of `files` that didn't exist at the base (new on this
// branch, vs. edited) — lets the caller tell a brand-new changeset apart from an
// edit to one that was already here.
async function changedFilesOnBranch(
	git: SimpleGit,
	config: ChangesetConfig
): Promise<{ files: string[]; added: Set<string> }> {
	const baseName =
		config.baseBranch ?? (await detectDefaultBranch(git).catch(() => undefined)) ?? 'main';
	const baseRef = (await revExists(git, `origin/${baseName}`))
		? `origin/${baseName}`
		: (await revExists(git, baseName))
			? baseName
			: null;

	const paths = new Set<string>();
	const added = new Set<string>();
	let mergeBase: string | null = null;
	if (baseRef) {
		try {
			mergeBase = (await git.raw(['merge-base', baseRef, 'HEAD'])).trim() || null;
		} catch {
			mergeBase = null;
		}
	}
	if (mergeBase) {
		const diff = await git.raw(['diff', '--name-status', mergeBase]).catch(() => '');
		for (const line of diff.split('\n')) {
			if (!line.trim()) continue;
			const parts = line.split('\t');
			const status = parts[0];
			const file = parts[parts.length - 1]?.trim();
			if (!file) continue;
			paths.add(file);
			if (status.startsWith('A')) added.add(file);
		}
	} else {
		// No base to diff against — consider just the working tree.
		const status = await git.raw(['status', '--porcelain', '-z']).catch(() => '');
		for (const entry of status.split('\0')) {
			if (entry.length > 3) {
				const file = entry.slice(3);
				const code = entry.slice(0, 2);
				paths.add(file);
				if (code === '??' || code[0] === 'A') added.add(file);
			}
		}
	}
	// Untracked files aren't in `diff`; add them explicitly — and they're new.
	const untracked = await git.raw(['ls-files', '--others', '--exclude-standard']).catch(() => '');
	for (const p of untracked.split('\n')) {
		const file = p.trim();
		if (file) {
			paths.add(file);
			added.add(file);
		}
	}

	return { files: [...paths], added };
}

// A `.changeset/<name>.md` file (paths from git are repo-root-relative, and the
// changeset dir always lives at the root). Excludes the dir's own README.
function isChangesetFile(file: string): boolean {
	return /^\.changeset\/[^/]+\.md$/i.test(file) && file.toLowerCase() !== '.changeset/readme.md';
}

// Map a changed file to the owning package by longest matching dir prefix.
function packagesForFiles(files: string[], packages: WorkspacePackage[]): string[] {
	// Longest dir first so a nested package wins over an ancestor.
	const byDir = [...packages].sort((a, b) => b.dir.length - a.dir.length);
	const changed = new Set<string>();
	for (const file of files) {
		if (file.startsWith('.changeset/')) continue; // the changesets themselves don't count
		for (const pkg of byDir) {
			const prefix = pkg.dir === '' ? '' : `${pkg.dir}/`;
			if (file === pkg.dir || file.startsWith(prefix)) {
				changed.add(pkg.name);
				break;
			}
		}
	}
	return [...changed];
}

// --- changesets introduced on this branch -----------------------------------

function packagesInChangeset(src: string): string[] {
	const m = FRONTMATTER_RE.exec(src);
	if (!m) return [];
	const names: string[] = [];
	for (const rawLine of m[1].split(/\r?\n/)) {
		// `'@scope/pkg': minor` — capture the (optionally quoted) key.
		const line = rawLine.trim();
		const kv = /^(['"]?)(.+?)\1\s*:\s*(patch|minor|major)\s*$/.exec(line);
		if (kv) names.push(kv[2]);
	}
	return names;
}

// The changeset files *introduced on this branch* (path + the packages each
// bumps). We only look at changeset files in `files` (the branch's changed /
// untracked set), never the whole `.changeset` dir — a changeset already sitting
// on the base branch for unrelated, unreleased work must not count here.
async function branchChangesetFiles(
	repoPath: string,
	files: string[],
	added: Set<string>
): Promise<{ path: string; packages: string[]; added: boolean }[]> {
	const out: { path: string; packages: string[]; added: boolean }[] = [];
	for (const file of files) {
		if (!isChangesetFile(file)) continue;
		try {
			const src = await fs.readFile(path.join(repoPath, file), 'utf8');
			out.push({ path: file, packages: packagesInChangeset(src), added: added.has(file) });
		} catch {
			// deleted on the branch / unreadable — covers nothing.
		}
	}
	return out;
}

// --- public API -------------------------------------------------------------

export async function getChangesetStatus(repoPath: string): Promise<ChangesetStatus> {
	const empty: ChangesetStatus = {
		installed: false,
		packages: [],
		changedPackages: [],
		coveredPackages: [],
		needsChangeset: false,
		branchChangesets: []
	};

	const config = await readChangesetConfig(repoPath);
	if (!config) return empty;

	const git = simpleGit(repoPath);
	const [packages, changed] = await Promise.all([
		listWorkspacePackages(repoPath, config),
		changedFilesOnBranch(git, config)
	]);
	const changedFiles = changed.files;

	// "Covered" means a changeset *added on this branch* — not one that was already
	// on the base branch — so existing changesets for other work don't suppress the
	// prompt.
	const branchChangesets = await branchChangesetFiles(repoPath, changedFiles, changed.added);
	const covered = [...new Set(branchChangesets.flatMap((c) => c.packages))];
	const changedPackages = packagesForFiles(changedFiles, packages);
	const coveredSet = new Set(covered);
	const needsChangeset = changedPackages.some((p) => !coveredSet.has(p));

	return {
		installed: true,
		packages,
		changedPackages,
		coveredPackages: covered,
		needsChangeset,
		branchChangesets
	};
}

// changesets-style three-word slug (adjective-noun-verb) so the filename reads
// like the ones the CLI generates. Short curated lists keep us dependency-free.
const ADJECTIVES = [
	'brave',
	'calm',
	'clever',
	'cool',
	'eager',
	'fair',
	'fancy',
	'fast',
	'fresh',
	'gentle',
	'happy',
	'honest',
	'jolly',
	'kind',
	'lazy',
	'lucky',
	'mighty',
	'neat',
	'odd',
	'proud',
	'quiet',
	'rare',
	'rich',
	'shy',
	'silly',
	'slow',
	'small',
	'smart',
	'soft',
	'spicy',
	'strong',
	'sweet',
	'tame',
	'tidy',
	'tough',
	'warm',
	'wild',
	'wise',
	'witty',
	'young'
];
const NOUNS = [
	'apples',
	'badgers',
	'balloons',
	'bottles',
	'boxes',
	'candles',
	'carrots',
	'cats',
	'chairs',
	'clouds',
	'corners',
	'crews',
	'dogs',
	'doors',
	'eagles',
	'falcons',
	'forks',
	'foxes',
	'frogs',
	'geese',
	'ghosts',
	'guests',
	'hotels',
	'islands',
	'jokes',
	'kings',
	'lamps',
	'lemons',
	'lions',
	'masks',
	'mirrors',
	'oranges',
	'otters',
	'pandas',
	'parrots',
	'planes',
	'rings',
	'rivers',
	'rockets',
	'shoes',
	'spiders',
	'tables',
	'teams',
	'tigers',
	'trains',
	'turtles',
	'waves',
	'zebras'
];
const VERBS = [
	'accept',
	'act',
	'bake',
	'begin',
	'bow',
	'build',
	'cheer',
	'climb',
	'cough',
	'dance',
	'dream',
	'drum',
	'fail',
	'fly',
	'glow',
	'grin',
	'grow',
	'hide',
	'hope',
	'hug',
	'jam',
	'jog',
	'jump',
	'kneel',
	'laugh',
	'learn',
	'march',
	'obey',
	'paint',
	'play',
	'pump',
	'race',
	'relax',
	'rescue',
	'rest',
	'rhyme',
	'shop',
	'sing',
	'sip',
	'smile',
	'sneeze',
	'sort',
	'study',
	'swim',
	'travel',
	'turn',
	'wait',
	'wave',
	'wink',
	'yawn'
];

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function randomSlug(): string {
	return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(VERBS)}`;
}

export async function createChangeset(
	repoPath: string,
	input: CreateChangesetInput
): Promise<string> {
	const packages = input.packages.filter((p) => p.trim() !== '');
	if (packages.length === 0) throw new Error('A changeset needs at least one package.');

	const dir = path.join(repoPath, '.changeset');
	await fs.mkdir(dir, { recursive: true });

	// Prefer the caller's slug when it's a safe filename and free; otherwise fall
	// back to a generated `adjective-noun-verb` name, retrying on collision.
	const requested = /^[a-z0-9-]+$/i.test(input.name ?? '') ? (input.name as string) : null;
	let slug = requested ?? randomSlug();
	for (
		let attempt = 0;
		attempt < 50 && (await pathExists(path.join(dir, `${slug}.md`)));
		attempt++
	) {
		slug = randomSlug();
	}
	const relPath = path.posix.join('.changeset', `${slug}.md`);

	const frontmatter = packages.map((p) => `'${p}': ${input.bump}`).join('\n');
	const body = input.description.trim();
	const contents = `---\n${frontmatter}\n---\n\n${body}\n`;

	await fs.writeFile(path.join(dir, `${slug}.md`), contents, 'utf8');
	return relPath;
}

// Delete a changeset file (e.g. one the user decided was unnecessary). Guarded to
// `.changeset/<name>.md` so it can never remove anything else; a committed-on-
// branch changeset becomes a pending deletion, an untracked one just disappears.
export async function removeChangeset(repoPath: string, relPath: string): Promise<void> {
	const normalized = relPath.split(path.sep).join('/');
	if (!isChangesetFile(normalized)) {
		throw new Error(`Refusing to remove non-changeset path: ${relPath}`);
	}
	await fs.rm(path.join(repoPath, normalized), { force: true });
}
