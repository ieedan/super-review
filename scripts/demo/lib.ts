import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export const DEMO_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(DEMO_DIR, '..', '..');
export const FIXTURES = path.join(DEMO_DIR, 'fixtures', 'ledger');

// The built CLI. The published npm build lags the source, so the seeder always
// invokes the freshly built dist directly with node (see the memory notes on
// the CLI's editor-var and base-branch quirks).
export const CLI_BIN = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'bin.mjs');

// A file we drop at the repo root so `--force` can tell "a demo repo the seeder
// owns and may wipe" apart from "some real repo the path happens to point at".
export const MARKER = '.ledger-demo';

// Every git and CLI call runs with the editor vars stripped: simple-git and the
// CLI otherwise inherit an interactive editor (npx re-injects EDITOR=vi) and a
// commit that opens $EDITOR hangs a headless seed forever.
//
// Note: we deliberately do NOT null GIT_CONFIG_GLOBAL/SYSTEM. Author identity is
// pinned per commit via authorEnv, so reproducibility does not need it, and
// nulling the global config makes simple-git's branch capture inside the CLI
// come back empty ("no committed changes to capture"), which the real app never
// hits because it runs with the user's own config.
const CLEAN_ENV: NodeJS.ProcessEnv = {
	...process.env,
	GIT_EDITOR: undefined,
	GIT_SEQUENCE_EDITOR: undefined,
	EDITOR: undefined,
	VISUAL: undefined
};

export interface RunOpts {
	cwd: string;
	// Extra env overrides (e.g. backdated commit timestamps + author identity).
	env?: NodeJS.ProcessEnv;
}

export async function git(args: string[], opts: RunOpts): Promise<string> {
	const { stdout } = await execFileAsync('git', args, {
		cwd: opts.cwd,
		env: { ...CLEAN_ENV, ...opts.env },
		maxBuffer: 64 * 1024 * 1024
	});
	return stdout;
}

export async function cli(args: string[], opts: RunOpts): Promise<string> {
	const { stdout } = await execFileAsync('node', [CLI_BIN, ...args], {
		cwd: opts.cwd,
		env: { ...CLEAN_ENV, ...opts.env },
		maxBuffer: 64 * 1024 * 1024
	});
	return stdout;
}

// A committer identity + timestamp, for backdating the baseline history so the
// History tab has something to show. Both author and committer dates are set so
// `git log` order is stable.
export function authorEnv(name: string, email: string, isoDate: string): NodeJS.ProcessEnv {
	return {
		GIT_AUTHOR_NAME: name,
		GIT_AUTHOR_EMAIL: email,
		GIT_COMMITTER_NAME: name,
		GIT_COMMITTER_EMAIL: email,
		GIT_AUTHOR_DATE: isoDate,
		GIT_COMMITTER_DATE: isoDate
	};
}

// Copy a fixture tree into the repo. Fixture paths that must ship as dotfiles are
// stored with a `_dot_` prefix (git and npm both ignore real dotfiles inside a
// package), and restored to their leading dot on copy: `_dot_gitignore` ->
// `.gitignore`, `_dot_changeset/config.json` -> `.changeset/config.json`.
export async function copyTree(src: string, dest: string): Promise<void> {
	const entries = await fs.readdir(src, { withFileTypes: true });
	for (const entry of entries) {
		const restored = entry.name.replace(/^_dot_/, '.');
		const from = path.join(src, entry.name);
		const to = path.join(dest, restored);
		if (entry.isDirectory()) {
			await fs.mkdir(to, { recursive: true });
			await copyTree(from, to);
		} else {
			await fs.mkdir(path.dirname(to), { recursive: true });
			await fs.copyFile(from, to);
		}
	}
}

// Read a JSON fixture next to the scripts (tours, task lists).
export async function readJson<T>(rel: string): Promise<T> {
	const raw = await fs.readFile(path.join(DEMO_DIR, rel), 'utf8');
	return JSON.parse(raw) as T;
}

export async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}
