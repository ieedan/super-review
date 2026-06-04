import { promises as fs, existsSync, watch, type FSWatcher } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LocalComment, LocalCommentAuthor, NewLocalCommentInput } from './types.js';

const execFileAsync = promisify(execFile);

// Comments are small, but read the same way sessions do for the read-only ref
// path; keep a generous cap so a `git show` never truncates into a parse error.
const MAX_COMMENT_BYTES = 16 * 1024 * 1024;

// Git always addresses paths with forward slashes, so the in-tree comments
// location is hardcoded posix rather than derived from `commentsDir` (which uses
// the OS separator). Used by the read-from-ref helpers below.
const COMMENTS_TREE_PATH = '.super-review/comments';

// Local comments live inside the repo so they can be committed and travel with a
// branch/PR — a reviewer's notes (and an agent's resolutions) move with the code.
// One JSON file per comment:
//
//   <repoPath>/.super-review/comments/<commentId>.json
//
// Keyed by the repo's filesystem path, like sessions. Comments are scoped to the
// diff context they were authored in via each record's `contextKey`; the dir is
// flat and the context filtering happens in memory (the set is small).
function commentsDir(repoPath: string): string {
	return path.join(repoPath, '.super-review', 'comments');
}

function commentPath(repoPath: string, id: string): string {
	return path.join(commentsDir(repoPath), `${id}.json`);
}

async function readComment(file: string): Promise<LocalComment | null> {
	try {
		const raw = await fs.readFile(file, 'utf8');
		return JSON.parse(raw) as LocalComment;
	} catch {
		// Missing or malformed — skip it rather than failing the listing.
		return null;
	}
}

// Newest-updated first, so the sidebar list reads most-recent at the top.
function byUpdatedDesc(a: LocalComment, b: LocalComment): number {
	return b.updatedAt - a.updatedAt;
}

// All comments for a repo (every context). Tolerates a missing directory and
// skips any record that won't parse.
export async function listComments(repoPath: string): Promise<LocalComment[]> {
	const dir = commentsDir(repoPath);
	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return [];
	}
	const comments = await Promise.all(
		entries
			.filter((name) => name.endsWith('.json'))
			.map((name) => readComment(path.join(dir, name)))
	);
	return comments.filter((c): c is LocalComment => c !== null).sort(byUpdatedDesc);
}

// Comments scoped to a single diff context (`diffContextKey(ctx)`).
export async function listCommentsForContext(
	repoPath: string,
	contextKey: string
): Promise<LocalComment[]> {
	return (await listComments(repoPath)).filter((c) => c.contextKey === contextKey);
}

export async function getComment(repoPath: string, id: string): Promise<LocalComment | null> {
	return readComment(commentPath(repoPath, id));
}

export async function writeComment(repoPath: string, comment: LocalComment): Promise<void> {
	const dir = commentsDir(repoPath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(commentPath(repoPath, comment.id), JSON.stringify(comment, null, 2), 'utf8');
}

export async function deleteComment(repoPath: string, id: string): Promise<void> {
	await fs.rm(commentPath(repoPath, id), { force: true });
}

// Remove every comment for a repo (a pre-merge purge, mirroring clearSessions).
export async function clearComments(repoPath: string): Promise<void> {
	await fs.rm(commentsDir(repoPath), { recursive: true, force: true });
}

// Cheap count of the repo's comments without parsing them.
export async function countComments(repoPath: string): Promise<number> {
	try {
		const entries = await fs.readdir(commentsDir(repoPath));
		return entries.filter((name) => name.endsWith('.json')).length;
	} catch {
		return 0;
	}
}

// Build a fresh comment from the caller's input, assigning the id + timestamps.
// Kept separate from `writeComment` so callers (IPC, CLI) can persist and then
// hand the record straight back to the renderer.
export function createComment(input: NewLocalCommentInput): LocalComment {
	const now = Date.now();
	return {
		id: randomUUID(),
		contextKey: input.contextKey,
		path: input.path,
		side: input.side,
		startLine: input.startLine,
		endLine: input.endLine,
		body: input.body,
		author: input.author,
		createdAt: now,
		updatedAt: now
	};
}

// Stamp a comment resolved (optionally linking the session that addressed it) and
// persist it. Returns the updated record, or null if the comment is gone.
export async function resolveComment(
	repoPath: string,
	id: string,
	resolver: LocalCommentAuthor,
	sessionId?: string | null
): Promise<LocalComment | null> {
	const comment = await getComment(repoPath, id);
	if (!comment) return null;
	const updated: LocalComment = {
		...comment,
		resolvedAt: Date.now(),
		resolvedBy: resolver,
		resolvedSessionId: sessionId ?? undefined,
		updatedAt: Date.now()
	};
	await writeComment(repoPath, updated);
	return updated;
}

// Clear a comment's resolution and persist it. Returns the updated record, or
// null if the comment is gone.
export async function unresolveComment(repoPath: string, id: string): Promise<LocalComment | null> {
	const comment = await getComment(repoPath, id);
	if (!comment) return null;
	const { resolvedAt: _a, resolvedBy: _b, resolvedSessionId: _c, ...rest } = comment;
	void _a;
	void _b;
	void _c;
	const updated: LocalComment = { ...rest, updatedAt: Date.now() };
	await writeComment(repoPath, updated);
	return updated;
}

// ─── Reading comments from a git ref ─────────────────────────────────────────
// Comments are committed into the branch (like sessions), so reviewing a branch
// or PR read-only — without checking it out — reads that ref's committed records
// straight from git's object store rather than the working tree on disk.

async function listCommentFilesAtRef(repoPath: string, ref: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['ls-tree', '--name-only', `${ref}:${COMMENTS_TREE_PATH}`],
			{ cwd: repoPath }
		);
		return stdout.split('\n').filter((name) => name.endsWith('.json'));
	} catch {
		return [];
	}
}

async function readCommentAtRef(
	repoPath: string,
	ref: string,
	name: string
): Promise<LocalComment | null> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['show', `${ref}:${COMMENTS_TREE_PATH}/${name}`],
			{
				cwd: repoPath,
				maxBuffer: MAX_COMMENT_BYTES
			}
		);
		return JSON.parse(stdout) as LocalComment;
	} catch {
		return null;
	}
}

// All comments committed at a git ref, scoped to a context — the read-only
// counterpart of `listCommentsForContext`.
export async function listCommentsForContextAtRef(
	repoPath: string,
	ref: string,
	contextKey: string
): Promise<LocalComment[]> {
	const names = await listCommentFilesAtRef(repoPath, ref);
	const comments = await Promise.all(names.map((name) => readCommentAtRef(repoPath, ref, name)));
	return comments
		.filter((c): c is LocalComment => c !== null)
		.filter((c) => c.contextKey === contextKey)
		.sort(byUpdatedDesc);
}

// Watch the repo's comments for changes and call `onChange` (debounced) whenever
// a record is written or removed — so an agent's CLI resolve (or another window's
// edit) shows up live. Mirrors `watchSessionsDir`: we watch `.super-review`
// recursively (catching the comments dir appearing/disappearing) and switch onto
// it the moment it exists. Returns a teardown function.
export function watchCommentsDir(repoPath: string, onChange: () => void): () => void {
	const superDir = path.join(repoPath, '.super-review');
	const commentsName = path.basename(commentsDir(repoPath));
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
					if (!file || file === commentsName || file.startsWith(commentsName + path.sep)) {
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
