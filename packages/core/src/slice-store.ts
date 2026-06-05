import { promises as fs, existsSync, watch, type FSWatcher } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Slice, SliceSummary } from './types.js';

const execFileAsync = promisify(execFile);

// Slices store no file content (only paths + narrative + anchors), so a manifest
// is tiny — but keep a generous cap on the `git show` read anyway for safety.
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

// Git addresses paths with forward slashes, so the in-tree slices location is
// hardcoded posix (mirrors session-store's SESSIONS_TREE_PATH).
const SLICES_TREE_PATH = '.super-review/slices';

// Slices live inside the repo so they can be committed to a branch and travel
// with a PR — a reviewer can pull the branch and open the documented tour (which
// renders live against that branch's code). One JSON manifest per slice:
//
//   <repoPath>/.super-review/slices/<sliceId>.json
//
// Keyed by the repo's filesystem path, like session-store.
function slicesDir(repoPath: string): string {
	return path.join(repoPath, '.super-review', 'slices');
}

function slicePath(repoPath: string, id: string): string {
	return path.join(slicesDir(repoPath), `${id}.json`);
}

// Drop the (potentially long) tour steps so listings stay cheap; the summary
// keeps the file/step counts for the card to show.
function toSummary(slice: Slice): SliceSummary {
	const { steps, files, ...rest } = slice;
	return { ...rest, fileCount: files?.length ?? 0, stepCount: steps?.length ?? 0 };
}

async function readSlice(file: string): Promise<Slice | null> {
	try {
		const raw = await fs.readFile(file, 'utf8');
		return JSON.parse(raw) as Slice;
	} catch {
		// Missing or malformed manifest — skip it rather than failing the listing.
		return null;
	}
}

// All slices for a repo, newest-updated first. Tolerates a missing directory
// (no slices yet) and skips any manifest that won't parse.
export async function listSlices(repoPath: string): Promise<SliceSummary[]> {
	const dir = slicesDir(repoPath);
	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return [];
	}
	const slices = await Promise.all(
		entries.filter((name) => name.endsWith('.json')).map((name) => readSlice(path.join(dir, name)))
	);
	return slices
		.filter((s): s is Slice => s !== null)
		.map(toSummary)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSlice(repoPath: string, id: string): Promise<Slice | null> {
	return readSlice(slicePath(repoPath, id));
}

// ─── Reading slices from a git ref ───────────────────────────────────────────
// Slices are committed into the branch, so reviewing a branch/PR read-only means
// reading that ref's committed manifests from git's object store (mirrors
// session-store's read-from-ref pair). The diff itself still renders live against
// that ref's content — only the manifest comes from the ref.

async function listSliceFilesAtRef(repoPath: string, ref: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['ls-tree', '--name-only', `${ref}:${SLICES_TREE_PATH}`],
			{ cwd: repoPath }
		);
		return stdout.split('\n').filter((name) => name.endsWith('.json'));
	} catch {
		return [];
	}
}

async function readSliceAtRef(repoPath: string, ref: string, name: string): Promise<Slice | null> {
	try {
		const { stdout } = await execFileAsync('git', ['show', `${ref}:${SLICES_TREE_PATH}/${name}`], {
			cwd: repoPath,
			maxBuffer: MAX_MANIFEST_BYTES
		});
		return JSON.parse(stdout) as Slice;
	} catch {
		return null;
	}
}

export async function listSlicesAtRef(repoPath: string, ref: string): Promise<SliceSummary[]> {
	const names = await listSliceFilesAtRef(repoPath, ref);
	const slices = await Promise.all(names.map((name) => readSliceAtRef(repoPath, ref, name)));
	return slices
		.filter((s): s is Slice => s !== null)
		.map(toSummary)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSliceAtRef(
	repoPath: string,
	ref: string,
	id: string
): Promise<Slice | null> {
	return readSliceAtRef(repoPath, ref, `${id}.json`);
}

export async function countSlicesAtRef(repoPath: string, ref: string): Promise<number> {
	return (await listSliceFilesAtRef(repoPath, ref)).length;
}

// Find a slice by its upsert key (the harness conversation/run id), so a re-save
// updates the existing slice instead of creating a new one.
export async function findSliceByKey(repoPath: string, key: string): Promise<Slice | null> {
	let entries: string[];
	try {
		entries = await fs.readdir(slicesDir(repoPath));
	} catch {
		return null;
	}
	for (const name of entries) {
		if (!name.endsWith('.json')) continue;
		const slice = await readSlice(path.join(slicesDir(repoPath), name));
		if (slice?.key === key) return slice;
	}
	return null;
}

export async function writeSlice(repoPath: string, slice: Slice): Promise<void> {
	const dir = slicesDir(repoPath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(slicePath(repoPath, slice.id), JSON.stringify(slice, null, 2), 'utf8');
}

export async function deleteSlice(repoPath: string, id: string): Promise<void> {
	await fs.rm(slicePath(repoPath, id), { force: true });
}

// Remove every slice for a repo — the "clear before merging" purge. Drops the
// whole slices directory so the committed manifests vanish from the working tree.
export async function clearSlices(repoPath: string): Promise<void> {
	await fs.rm(slicesDir(repoPath), { recursive: true, force: true });
}

// Cheap count of the repo's slices (drives the tab badge) — tallies manifest
// files without parsing them. Missing dir means no slices.
export async function countSlices(repoPath: string): Promise<number> {
	try {
		const entries = await fs.readdir(slicesDir(repoPath));
		return entries.filter((name) => name.endsWith('.json')).length;
	} catch {
		return 0;
	}
}

// Watch the repo's slices for changes and call `onChange` (debounced) whenever a
// manifest is written, removed, or the whole set is cleared — so an agent's CLI
// save (or an external purge) shows up in the app immediately. Mirrors
// session-store's watcher exactly (see it for why we watch `.super-review`
// recursively and fall back to the nearest existing ancestor).
export function watchSlicesDir(repoPath: string, onChange: () => void): () => void {
	const superDir = path.join(repoPath, '.super-review');
	const slicesName = path.basename(slicesDir(repoPath));
	let watcher: FSWatcher | null = null;
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let rearmTimer: ReturnType<typeof setTimeout> | null = null;
	let closed = false;

	const notify = (): void => {
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(onChange, 150);
	};

	const deepestExisting = (): string => {
		let dir = superDir;
		while (!existsSync(dir)) dir = path.dirname(dir);
		return dir;
	};

	const arm = (): void => {
		if (closed) return;
		const dir = deepestExisting();
		const watchingSuper = dir === superDir;
		try {
			watcher = watch(dir, watchingSuper ? { recursive: true } : undefined, (_event, file) => {
				if (watchingSuper) {
					if (!file || file === slicesName || file.startsWith(slicesName + path.sep)) {
						notify();
					}
				} else if (existsSync(superDir)) {
					rearm();
				}
			});
			watcher.on('error', scheduleRearm);
		} catch {
			scheduleRearm();
		}
	};

	function rearm(): void {
		if (closed) return;
		try {
			watcher?.close();
		} catch {
			/* already gone */
		}
		watcher = null;
		arm();
		notify();
	}

	function scheduleRearm(): void {
		if (closed || rearmTimer) return;
		rearmTimer = setTimeout(() => {
			rearmTimer = null;
			rearm();
		}, 200);
	}

	arm();

	return () => {
		closed = true;
		if (debounce) clearTimeout(debounce);
		if (rearmTimer) clearTimeout(rearmTimer);
		try {
			watcher?.close();
		} catch {
			/* already gone */
		}
		watcher = null;
	};
}
