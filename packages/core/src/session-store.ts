import { promises as fs, existsSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { Session, SessionSummary } from './types.js';

// Sessions live inside the repo so they can be committed to a branch and travel
// with a PR — a reviewer can pull the branch and open the documented tour without
// it having been authored on their machine. One JSON manifest per session.
//
//   <repoPath>/.super-review/sessions/<sessionId>.json
//
// Functions are keyed by the repo's filesystem path (the standalone CLI has the
// repo root; the Electron app resolves it from the stored RepoInfo).
function sessionsDir(repoPath: string): string {
	return path.join(repoPath, '.super-review', 'sessions');
}

function sessionPath(repoPath: string, id: string): string {
	return path.join(sessionsDir(repoPath), `${id}.json`);
}

// Drop the heavy per-file contents and tour steps so listings stay cheap; the
// summary keeps just the step count for the list to show.
function toSummary(session: Session): SessionSummary {
	const { files: _files, steps, ...rest } = session;
	return { ...rest, stepCount: steps?.length ?? 0 };
}

async function readSession(file: string): Promise<Session | null> {
	try {
		const raw = await fs.readFile(file, 'utf8');
		return JSON.parse(raw) as Session;
	} catch {
		// Missing or malformed manifest — skip it rather than failing the listing.
		return null;
	}
}

// All sessions for a repo, newest-updated first. Tolerates a missing directory
// (no sessions yet) and skips any manifest that won't parse.
export async function listSessions(repoPath: string): Promise<SessionSummary[]> {
	const dir = sessionsDir(repoPath);
	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return [];
	}
	const sessions = await Promise.all(
		entries
			.filter((name) => name.endsWith('.json'))
			.map((name) => readSession(path.join(dir, name)))
	);
	return sessions
		.filter((s): s is Session => s !== null)
		.map(toSummary)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSession(repoPath: string, id: string): Promise<Session | null> {
	return readSession(sessionPath(repoPath, id));
}

// Find a session by its upsert key (the harness conversation/run id). Used by
// the CLI to decide between creating a new session and updating an existing one.
export async function findSessionByKey(repoPath: string, key: string): Promise<Session | null> {
	let entries: string[];
	try {
		entries = await fs.readdir(sessionsDir(repoPath));
	} catch {
		return null;
	}
	for (const name of entries) {
		if (!name.endsWith('.json')) continue;
		const session = await readSession(path.join(sessionsDir(repoPath), name));
		if (session?.key === key) return session;
	}
	return null;
}

export async function writeSession(repoPath: string, session: Session): Promise<void> {
	const dir = sessionsDir(repoPath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(sessionPath(repoPath, session.id), JSON.stringify(session, null, 2), 'utf8');
}

export async function deleteSession(repoPath: string, id: string): Promise<void> {
	await fs.rm(sessionPath(repoPath, id), { force: true });
}

// Remove every session for a repo — the "clear before merging" purge. Drops the
// whole sessions directory so the committed manifests vanish from the working
// tree (git then sees them as deleted, ready to commit off the PR branch).
export async function clearSessions(repoPath: string): Promise<void> {
	await fs.rm(sessionsDir(repoPath), { recursive: true, force: true });
}

// Cheap count of the repo's sessions — just tallies manifest files without
// parsing them, so the tab badge can stay live without reading every (large)
// manifest. Missing dir means no sessions.
export async function countSessions(repoPath: string): Promise<number> {
	try {
		const entries = await fs.readdir(sessionsDir(repoPath));
		return entries.filter((name) => name.endsWith('.json')).length;
	} catch {
		return 0;
	}
}

// Watch the repo's sessions for changes and call `onChange` (debounced) whenever
// a manifest is written, removed, or the whole set is cleared — so an agent's CLI
// save (or an external purge) shows up in the app immediately. Returns a teardown
// function. See the body for how the watch target is chosen.
export function watchSessionsDir(repoPath: string, onChange: () => void): () => void {
	// We watch the `.super-review` dir *recursively* rather than `sessions`
	// itself: a recursive watch catches manifest writes AND the sessions dir
	// being removed by a purge (which a direct watch on the deleted dir misses on
	// macOS). `.super-review` usually doesn't exist yet, so until it does we watch
	// the nearest existing ancestor (the repo root always exists) — never
	// recursively, so we don't walk the whole repo — and switch onto
	// `.super-review` the moment it appears.
	const superDir = path.join(repoPath, '.super-review');
	const sessionsName = path.basename(sessionsDir(repoPath));
	let watcher: FSWatcher | null = null;
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let rearmTimer: ReturnType<typeof setTimeout> | null = null;
	let closed = false;

	// fs.watch emits several events per write; coalesce them into one reload.
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
					// Only react to changes within the sessions subdir (file is relative
					// to `.super-review`, e.g. "sessions" or "sessions/<id>.json").
					if (!file || file === sessionsName || file.startsWith(sessionsName + path.sep)) {
						notify();
					}
				} else if (existsSync(superDir)) {
					// `.super-review` just appeared — move the recursive watch onto it.
					rearm();
				}
			});
			// A removed/replaced watched dir surfaces as an error on some platforms;
			// back off briefly then re-arm from the nearest surviving ancestor.
			watcher.on('error', scheduleRearm);
		} catch {
			scheduleRearm();
		}
	};

	// Re-point the watch and re-sync. A rearm always means the watched location
	// changed — either a deeper path segment appeared, or the sessions dir was
	// removed (e.g. an external `session clear`) — so notify either way.
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
