import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { LocalCommentAuthor } from './types.js';

// The single table backing local review comments. One database holds every
// repo's comments (see comment-store), so each row carries the `repo` it belongs
// to. Mirrors `LocalComment` otherwise: line anchor (path + side + start/end),
// the markdown body, the author, timestamps, and optional resolution.
// `author`/`resolvedBy` are JSON columns. `resolved_at` being non-null ⇒ resolved.
import type { GithubCommentBinding } from './types.js';

export const comments = sqliteTable('comments', {
	id: text('id').primaryKey(),
	// Absolute, resolved path of the repo this comment belongs to.
	repo: text('repo').notNull(),
	// Legacy coarse bucket; no longer the identity (the anchor is). Kept NOT NULL
	// with a '' default for back-compat with existing databases.
	contextKey: text('context_key').notNull(),
	path: text('path').notNull(),
	side: text('side').$type<'LEFT' | 'RIGHT'>().notNull(),
	startLine: integer('start_line').notNull(),
	endLine: integer('end_line').notNull(),
	// Anchor fingerprint of the commented line text(s); null on legacy rows.
	fingerprint: text('fingerprint'),
	body: text('body').notNull(),
	author: text('author', { mode: 'json' }).$type<LocalCommentAuthor>().notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
	// Set only once the comment is posted to GitHub (JSON); null otherwise.
	githubBinding: text('github_binding', { mode: 'json' }).$type<GithubCommentBinding>(),
	resolvedAt: integer('resolved_at'),
	resolvedBy: text('resolved_by', { mode: 'json' }).$type<LocalCommentAuthor>(),
	resolvedSessionId: text('resolved_session_id')
});

// Hand-written DDL kept in step with the schema above. Run on first open so both
// the desktop app and the CLI can create the database on demand without a
// separate migration step (the table is tiny and append-mostly). The index keeps
// the per-context listing fast now that one DB spans every repo.
export const CREATE_COMMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS comments (
	id TEXT PRIMARY KEY,
	repo TEXT NOT NULL,
	context_key TEXT NOT NULL,
	path TEXT NOT NULL,
	side TEXT NOT NULL,
	start_line INTEGER NOT NULL,
	end_line INTEGER NOT NULL,
	fingerprint TEXT,
	body TEXT NOT NULL,
	author TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	github_binding TEXT,
	resolved_at INTEGER,
	resolved_by TEXT,
	resolved_session_id TEXT
);
CREATE INDEX IF NOT EXISTS comments_repo_context ON comments (repo, context_key);
CREATE INDEX IF NOT EXISTS comments_repo_path ON comments (repo, path);
`;

// Columns added after the original schema shipped. Applied idempotently on open
// (a plain `ALTER TABLE ADD COLUMN` errors if the column already exists, so the
// store guards each against the live table_info — see ensureColumns).
export const COMMENT_COLUMN_MIGRATIONS: Array<{ name: string; ddl: string }> = [
	{ name: 'fingerprint', ddl: 'ALTER TABLE comments ADD COLUMN fingerprint TEXT;' },
	{ name: 'github_binding', ddl: 'ALTER TABLE comments ADD COLUMN github_binding TEXT;' }
];
