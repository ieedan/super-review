import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { and, desc, eq, sql } from 'drizzle-orm';
import { comments, CREATE_COMMENTS_TABLE } from './comment-schema.js';
import type { LocalComment, LocalCommentAuthor, NewLocalCommentInput } from './types.js';

// Local review comments live in a single SQLite database inside the repo:
//
//   <repoPath>/.super-review/comments.db
//
// Unlike sessions, this file is git-ignored (see the repo .gitignore) — comments
// are a personal, per-clone review aid, so they never pollute `git status` or get
// committed. Both the desktop app and the standalone CLI open the same file
// through this module (libSQL's driver is N-API, so it loads in plain Node and in
// Electron without a rebuild), which is what lets an agent read/resolve a
// reviewer's comments from the CLI.
const COMMENTS_DB_NAME = 'comments.db';

function superDir(repoPath: string): string {
	return path.join(repoPath, '.super-review');
}

function commentsDbPath(repoPath: string): string {
	return path.join(superDir(repoPath), COMMENTS_DB_NAME);
}

// One libSQL client + Drizzle handle per database file, created lazily and
// reused. `ready` resolves once the schema has been ensured, so every call
// awaits it before touching the table.
interface Handle {
	client: Client;
	db: LibSQLDatabase;
	ready: Promise<void>;
}
// Plain module-level cache (node-only module; not reactive state).
const handles = new Map<string, Handle>();

function getHandle(repoPath: string): Handle {
	const dbPath = commentsDbPath(repoPath);
	let handle = handles.get(dbPath);
	if (!handle) {
		mkdirSync(superDir(repoPath), { recursive: true });
		// libSQL wants a forward-slash file URL even on Windows.
		const client = createClient({ url: `file:${dbPath.replace(/\\/g, '/')}` });
		const db = drizzle(client);
		const ready = client.execute(CREATE_COMMENTS_TABLE).then(() => undefined);
		handle = { client, db, ready };
		handles.set(dbPath, handle);
	}
	return handle;
}

async function getDb(repoPath: string): Promise<LibSQLDatabase> {
	const handle = getHandle(repoPath);
	await handle.ready;
	return handle.db;
}

// A queried row carries every column (nullable ones as null); map it back to the
// `LocalComment` shape, dropping absent optional fields so resolved/unresolved is
// expressed by presence (matching the JSON shape the rest of the app expects).
type Row = typeof comments.$inferSelect;
function rowToComment(r: Row): LocalComment {
	return {
		id: r.id,
		contextKey: r.contextKey,
		path: r.path,
		side: r.side,
		startLine: r.startLine,
		endLine: r.endLine,
		body: r.body,
		author: r.author,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		...(r.resolvedAt != null ? { resolvedAt: r.resolvedAt } : {}),
		...(r.resolvedBy != null ? { resolvedBy: r.resolvedBy } : {}),
		...(r.resolvedSessionId != null ? { resolvedSessionId: r.resolvedSessionId } : {})
	};
}

// All comments for a repo (every context), newest-updated first.
export async function listComments(repoPath: string): Promise<LocalComment[]> {
	const db = await getDb(repoPath);
	const rows = await db.select().from(comments).orderBy(desc(comments.updatedAt));
	return rows.map(rowToComment);
}

// Comments scoped to a single diff context (`diffContextKey(ctx)`).
export async function listCommentsForContext(
	repoPath: string,
	contextKey: string
): Promise<LocalComment[]> {
	const db = await getDb(repoPath);
	const rows = await db
		.select()
		.from(comments)
		.where(eq(comments.contextKey, contextKey))
		.orderBy(desc(comments.updatedAt));
	return rows.map(rowToComment);
}

export async function getComment(repoPath: string, id: string): Promise<LocalComment | null> {
	const db = await getDb(repoPath);
	const rows = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
	return rows[0] ? rowToComment(rows[0]) : null;
}

// Build a fresh comment from the caller's input, assigning the id + timestamps.
// Pure (no DB) so callers can persist and then hand the record straight back.
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

// Upsert a comment (insert, or replace an existing row with the same id).
export async function writeComment(repoPath: string, comment: LocalComment): Promise<void> {
	const db = await getDb(repoPath);
	const values: Row = {
		id: comment.id,
		contextKey: comment.contextKey,
		path: comment.path,
		side: comment.side,
		startLine: comment.startLine,
		endLine: comment.endLine,
		body: comment.body,
		author: comment.author,
		createdAt: comment.createdAt,
		updatedAt: comment.updatedAt,
		resolvedAt: comment.resolvedAt ?? null,
		resolvedBy: comment.resolvedBy ?? null,
		resolvedSessionId: comment.resolvedSessionId ?? null
	};
	await db.insert(comments).values(values).onConflictDoUpdate({ target: comments.id, set: values });
}

// Convenience for callers that create-and-persist in one step (IPC `add`).
export async function addComment(
	repoPath: string,
	input: NewLocalCommentInput
): Promise<LocalComment> {
	const comment = createComment(input);
	await writeComment(repoPath, comment);
	return comment;
}

export async function deleteComment(repoPath: string, id: string): Promise<void> {
	const db = await getDb(repoPath);
	await db.delete(comments).where(eq(comments.id, id));
}

// Remove every comment for a repo (a pre-merge purge, mirroring clearSessions).
export async function clearComments(repoPath: string): Promise<void> {
	const db = await getDb(repoPath);
	await db.delete(comments);
}

// Cheap count of the repo's comments.
export async function countComments(repoPath: string): Promise<number> {
	const db = await getDb(repoPath);
	const rows = await db.select({ n: sql<number>`count(*)` }).from(comments);
	return Number(rows[0]?.n ?? 0);
}

// Stamp a comment resolved (optionally linking the session that addressed it).
// Returns the updated record, or null if the comment is gone.
export async function resolveComment(
	repoPath: string,
	id: string,
	resolver: LocalCommentAuthor,
	sessionId?: string | null
): Promise<LocalComment | null> {
	const existing = await getComment(repoPath, id);
	if (!existing) return null;
	const db = await getDb(repoPath);
	const now = Date.now();
	await db
		.update(comments)
		.set({
			resolvedAt: now,
			resolvedBy: resolver,
			resolvedSessionId: sessionId ?? null,
			updatedAt: now
		})
		.where(eq(comments.id, id));
	return {
		...existing,
		resolvedAt: now,
		resolvedBy: resolver,
		...(sessionId ? { resolvedSessionId: sessionId } : {}),
		updatedAt: now
	};
}

// Clear a comment's resolution. Returns the updated record, or null if gone.
export async function unresolveComment(repoPath: string, id: string): Promise<LocalComment | null> {
	const existing = await getComment(repoPath, id);
	if (!existing) return null;
	const db = await getDb(repoPath);
	const now = Date.now();
	await db
		.update(comments)
		.set({ resolvedAt: null, resolvedBy: null, resolvedSessionId: null, updatedAt: now })
		.where(eq(comments.id, id));
	const { resolvedAt: _a, resolvedBy: _b, resolvedSessionId: _c, ...rest } = existing;
	void _a;
	void _b;
	void _c;
	return { ...rest, updatedAt: now };
}

// Find a comment by a (contextKey, line, side) anchor — handy for the CLI. Unused
// internally but kept alongside the other lookups for symmetry.
export async function findCommentAt(
	repoPath: string,
	contextKey: string,
	filePath: string,
	startLine: number,
	side: 'LEFT' | 'RIGHT'
): Promise<LocalComment | null> {
	const db = await getDb(repoPath);
	const rows = await db
		.select()
		.from(comments)
		.where(
			and(
				eq(comments.contextKey, contextKey),
				eq(comments.path, filePath),
				eq(comments.startLine, startLine),
				eq(comments.side, side)
			)
		)
		.limit(1);
	return rows[0] ? rowToComment(rows[0]) : null;
}

// Watch the repo's comments database for changes and call `onChange` (debounced)
// whenever it's written — so an agent's CLI resolve (or another window's edit)
// shows up live. Mirrors `watchSessionsDir`: we watch `.super-review` recursively
// (also catching the dir/db appearing) and switch onto it the moment it exists.
// libSQL writes touch `comments.db` plus its `-wal`/`-shm` sidecars, so we match
// any path starting with the db name. Returns a teardown function.
export function watchCommentsDir(repoPath: string, onChange: () => void): () => void {
	const dir = superDir(repoPath);
	let watcher: FSWatcher | null = null;
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let rearmTimer: ReturnType<typeof setTimeout> | null = null;
	let closed = false;

	const notify = (): void => {
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(onChange, 150);
	};

	const deepestExisting = (): string => {
		let d = dir;
		while (!existsSync(d)) d = path.dirname(d);
		return d;
	};

	const arm = (): void => {
		if (closed) return;
		const target = deepestExisting();
		const watchingSuper = target === dir;
		try {
			watcher = watch(target, watchingSuper ? { recursive: true } : undefined, (_event, file) => {
				if (watchingSuper) {
					// `file` is relative to `.super-review` (e.g. "comments.db-wal").
					if (!file || path.basename(file).startsWith(COMMENTS_DB_NAME)) notify();
				} else if (existsSync(dir)) {
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
