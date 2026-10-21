import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import type { LocalCommentAuthor } from './types.js';

const author: LocalCommentAuthor = { kind: 'human', name: 'me' };
let home: string;
let store: typeof import('./comment-store.js');

beforeAll(async () => {
	home = mkdtempSync(path.join(tmpdir(), 'sr-comments-'));
	// A database created before the anchor column existed must be migrated in place.
	mkdirSync(path.join(home, '.super-review'));
	const old = createClient({ url: `file:${path.join(home, '.super-review', 'comments.db')}` });
	await old.execute(`CREATE TABLE comments (
		id TEXT PRIMARY KEY, repo TEXT NOT NULL, context_key TEXT NOT NULL, path TEXT NOT NULL,
		side TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, body TEXT NOT NULL,
		author TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
		in_reply_to TEXT, resolved_at INTEGER, resolved_by TEXT, resolved_session_id TEXT)`);
	await old.execute(
		`INSERT INTO comments VALUES ('legacy','/r','workingTree','a.ts','RIGHT',3,3,'old',
		'{"kind":"human","name":"me"}',1,1,NULL,NULL,NULL,NULL)`
	);
	old.close();
	vi.stubEnv('HOME', home);
	vi.stubEnv('USERPROFILE', home);
	store = await import('./comment-store.js');
});

afterAll(() => {
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

describe('comment anchors in the store', () => {
	it('reads a legacy row (no anchor) after migrating', async () => {
		const [c] = await store.listComments('/r');
		expect(c.id).toBe('legacy');
		expect(c.anchor).toBeUndefined();
	});

	it('persists an anchor and carries it onto replies', async () => {
		const anchor = { lines: ['return x;'], before: ['{'], after: ['}'] };
		const root = await store.addComment('/r', {
			contextKey: 'workingTree',
			path: 'a.ts',
			side: 'RIGHT',
			startLine: 4,
			endLine: 4,
			anchor,
			body: 'hi',
			author
		});
		expect((await store.getComment('/r', root.id))?.anchor).toEqual(anchor);
		const reply = await store.replyToComment('/r', root.id, 'yo', author);
		expect(reply?.anchor).toEqual(anchor);
	});
});
