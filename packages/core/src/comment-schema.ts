import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { LocalCommentAuthor } from './types.js';

// The single table backing local review comments. Mirrors `LocalComment`: line
// anchor (path + side + start/end), the markdown body, the author, timestamps,
// and optional resolution. `author`/`resolvedBy` are stored as JSON columns
// (Drizzle (de)serializes them). `resolved_at` being non-null means resolved.
export const comments = sqliteTable('comments', {
	id: text('id').primaryKey(),
	contextKey: text('context_key').notNull(),
	path: text('path').notNull(),
	side: text('side').$type<'LEFT' | 'RIGHT'>().notNull(),
	startLine: integer('start_line').notNull(),
	endLine: integer('end_line').notNull(),
	body: text('body').notNull(),
	author: text('author', { mode: 'json' }).$type<LocalCommentAuthor>().notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
	resolvedAt: integer('resolved_at'),
	resolvedBy: text('resolved_by', { mode: 'json' }).$type<LocalCommentAuthor>(),
	resolvedSessionId: text('resolved_session_id')
});

// Hand-written DDL kept in step with the schema above. Run on first open so both
// the desktop app and the CLI can create the database on demand without a
// separate migration step (the table is tiny and append-mostly).
export const CREATE_COMMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS comments (
	id TEXT PRIMARY KEY,
	context_key TEXT NOT NULL,
	path TEXT NOT NULL,
	side TEXT NOT NULL,
	start_line INTEGER NOT NULL,
	end_line INTEGER NOT NULL,
	body TEXT NOT NULL,
	author TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	resolved_at INTEGER,
	resolved_by TEXT,
	resolved_session_id TEXT
);
`;
