import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { and, desc, eq, sql } from 'drizzle-orm';
import { comments, CREATE_COMMENTS_TABLE } from './comment-schema.js';
import type { LocalComment, LocalCommentAuthor, NewLocalCommentInput } from './types.js';

// Local review comments live in ONE SQLite database for the whole application,
// outside of any repo:
//
//   ~/.super-review/comments.db
//
// They're a personal, per-machine review aid, so they're deliberately NOT stored
// in (or committed to) the repo — unlike sessions, which travel with a branch.
// Each row carries the `repo` it belongs to, so a single database serves every
// repo you review. Both the desktop app and the standalone CLI open this same
// file (libSQL's driver is N-API, so it loads in plain Node and in Electron
// without a rebuild), which is what lets an agent read/resolve a reviewer's
// comments from the CLI.
function appDir(): string {
	return path.join(homedir(), '.super-review');
}

function appDbPath(): string {
	return path.join(appDir(), 'comments.db');
}

// Canonical key for a repo: its absolute, resolved path. The desktop app passes
// its RepoInfo.path and the CLI passes the git toplevel — both resolve to the
// same string, so app-written and CLI-written comments line up.
function repoKey(repoPath: string): string {
	return path.resolve(repoPath);
}

// One libSQL client + Drizzle handle for the application database, created lazily
// and reused. `ready` resolves once the schema has been ensured.
interface Handle {
	client: Client;
	db: LibSQLDatabase;
	ready: Promise<void>;
}
let handle: Handle | null = null;

function getHandle(): Handle {
	if (!handle) {
		mkdirSync(appDir(), { recursive: true });
		// libSQL wants a forward-slash file URL even on Windows.
		const client = createClient({ url: `file:${appDbPath().replace(/\\/g, '/')}` });
		const db = drizzle(client);
		// `executeMultiple` runs the table + index DDL (two statements) in one call.
		const ready = client.executeMultiple(CREATE_COMMENTS_TABLE).then(() => undefined);
		handle = { client, db, ready };
	}
	return handle;
}

async function getDb(): Promise<LibSQLDatabase> {
	const h = getHandle();
	await h.ready;
	return h.db;
}

// A queried row carries every column; map it back to the `LocalComment` shape,
// dropping the storage-only `repo` column and absent optional fields so
// resolved/unresolved is expressed by presence (matching the shape the rest of
// the app expects).
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
	const db = await getDb();
	const rows = await db
		.select()
		.from(comments)
		.where(eq(comments.repo, repoKey(repoPath)))
		.orderBy(desc(comments.updatedAt));
	return rows.map(rowToComment);
}

// Comments scoped to a single diff context (`diffContextKey(ctx)`) within a repo.
export async function listCommentsForContext(
	repoPath: string,
	contextKey: string
): Promise<LocalComment[]> {
	const db = await getDb();
	const rows = await db
		.select()
		.from(comments)
		.where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.contextKey, contextKey)))
		.orderBy(desc(comments.updatedAt));
	return rows.map(rowToComment);
}

// The desktop app files each comment under a diff-context key (see DiffContext /
// diffContextKey): `workingTree`, `branch:<base>..<head>`, `pr:<n>`, and so on.
// An agent only ever acts on two of these — a pull request, or the local branch
// it's checked out on — so these two helpers are the CLI's whole view of them.

// Comments left while reviewing a pull request's diff (`pr:<n>`).
export async function listCommentsForPR(
	repoPath: string,
	prNumber: number
): Promise<LocalComment[]> {
	return listCommentsForContext(repoPath, `pr:${prNumber}`);
}

// Comments left on the *local* review of `branch`: the working-tree diff, plus
// any branch diff whose head is this branch. The base the reviewer diffed
// against is irrelevant here — the agent is on one branch and only wants its own
// comments — so we match on the head alone. A null branch (detached HEAD) leaves
// just the working-tree comments.
export async function listLocalComments(
	repoPath: string,
	branch: string | null
): Promise<LocalComment[]> {
	const all = await listComments(repoPath);
	const headSuffix = branch ? `..${branch}` : null;
	return all.filter(
		(c) =>
			c.contextKey === 'workingTree' ||
			(headSuffix !== null && c.contextKey.startsWith('branch:') && c.contextKey.endsWith(headSuffix))
	);
}

export async function getComment(repoPath: string, id: string): Promise<LocalComment | null> {
	const db = await getDb();
	const rows = await db
		.select()
		.from(comments)
		.where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id)))
		.limit(1);
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

// Upsert a comment for a repo (insert, or replace an existing row with the same id).
export async function writeComment(repoPath: string, comment: LocalComment): Promise<void> {
	const db = await getDb();
	const values: Row = {
		id: comment.id,
		repo: repoKey(repoPath),
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
	const db = await getDb();
	await db.delete(comments).where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id)));
}

// Remove every comment for a repo (a pre-merge purge, mirroring clearSessions).
export async function clearComments(repoPath: string): Promise<void> {
	const db = await getDb();
	await db.delete(comments).where(eq(comments.repo, repoKey(repoPath)));
}

// Cheap count of a repo's comments.
export async function countComments(repoPath: string): Promise<number> {
	const db = await getDb();
	const rows = await db
		.select({ n: sql<number>`count(*)` })
		.from(comments)
		.where(eq(comments.repo, repoKey(repoPath)));
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
	const db = await getDb();
	const now = Date.now();
	await db
		.update(comments)
		.set({
			resolvedAt: now,
			resolvedBy: resolver,
			resolvedSessionId: sessionId ?? null,
			updatedAt: now
		})
		.where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id)));
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
	const db = await getDb();
	const now = Date.now();
	await db
		.update(comments)
		.set({ resolvedAt: null, resolvedBy: null, resolvedSessionId: null, updatedAt: now })
		.where(and(eq(comments.repo, repoKey(repoPath)), eq(comments.id, id)));
	const { resolvedAt: _a, resolvedBy: _b, resolvedSessionId: _c, ...rest } = existing;
	void _a;
	void _b;
	void _c;
	return { ...rest, updatedAt: now };
}

// Watch the application comments database for changes and call `onChange`
// (debounced) whenever it's written — so an agent's CLI resolve (or another
// window's edit) shows up live. The DB is app-wide, so this watches
// ~/.super-review (libSQL writes touch comments.db plus its `-wal`/`-shm`
// sidecars). The `repoPath` parameter is accepted for call-site symmetry with
// the session watcher but isn't used — every window watches the same file.
// Returns a teardown function.
export function watchCommentsDir(_repoPath: string, onChange: () => void): () => void {
	const dir = appDir();
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
		const watchingApp = target === dir;
		try {
			watcher = watch(target, (_event, file) => {
				if (watchingApp) {
					if (!file || path.basename(file).startsWith('comments.db')) notify();
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
