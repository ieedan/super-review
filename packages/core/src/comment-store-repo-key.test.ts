import { mkdtempSync, mkdirSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import type { LocalCommentAuthor } from './types.js';

const author: LocalCommentAuthor = { kind: 'human', name: 'me' };
let home: string;
let realRepo: string;
let linkRepo: string;
let store: typeof import('./comment-store.js');

const input = (body: string) => ({
	contextKey: 'workingTree',
	path: 'a.ts',
	side: 'RIGHT' as const,
	startLine: 1,
	endLine: 1,
	body,
	author
});

beforeAll(async () => {
	home = realpathSync(mkdtempSync(path.join(tmpdir(), 'sr-repokey-')));
	realRepo = path.join(home, 'Work', 'repo');
	mkdirSync(realRepo, { recursive: true });
	linkRepo = path.join(home, 'link');
	symlinkSync(realRepo, linkRepo);

	// A database written before keys were canonical: one repo's comments filed under
	// a symlinked spelling of its path, another's under the real one.
	mkdirSync(path.join(home, '.super-review'));
	const old = createClient({ url: `file:${path.join(home, '.super-review', 'comments.db')}` });
	await old.execute(`CREATE TABLE comments (
		id TEXT PRIMARY KEY, repo TEXT NOT NULL, context_key TEXT NOT NULL, path TEXT NOT NULL,
		side TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, body TEXT NOT NULL,
		author TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
		in_reply_to TEXT, anchor TEXT, resolved_at INTEGER, resolved_by TEXT, resolved_session_id TEXT)`);
	const row = (id: string, repo: string) =>
		old.execute({
			sql: `INSERT INTO comments VALUES (?,?,'workingTree','a.ts','RIGHT',1,1,?,'{"kind":"human","name":"me"}',1,1,NULL,NULL,NULL,NULL,NULL)`,
			args: [id, repo, id]
		});
	await row('via-link', linkRepo);
	await row('via-real', realRepo);
	await row('gone', path.join(home, 'deleted-repo'));
	old.close();

	vi.stubEnv('HOME', home);
	vi.stubEnv('USERPROFILE', home);
	store = await import('./comment-store.js');
});

afterAll(() => {
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

describe('repo key canonicalisation', () => {
	it('folds rows saved under a symlinked spelling into the real path', async () => {
		const ids = (await store.listComments(realRepo)).map((c) => c.id).sort();
		expect(ids).toEqual(['via-link', 'via-real']);
	});

	it('shows the same comments whichever spelling the caller uses', async () => {
		const viaLink = (await store.listComments(linkRepo)).map((c) => c.id).sort();
		const viaReal = (await store.listComments(realRepo)).map((c) => c.id).sort();
		expect(viaLink).toEqual(viaReal);
	});

	it('a comment written through one spelling is visible through the other', async () => {
		const c = await store.addComment(linkRepo, input('hello'));
		expect((await store.getComment(realRepo, c.id))?.body).toBe('hello');
	});

	it('leaves rows for repos that no longer exist untouched', async () => {
		const gone = path.join(home, 'deleted-repo');
		expect((await store.listComments(gone)).map((c) => c.id)).toEqual(['gone']);
	});

	// Only meaningful on a case-insensitive filesystem (macOS default, Windows).
	const insensitive = (() => {
		const p = mkdtempSync(path.join(tmpdir(), 'Sr-Case-'));
		const ok = existsSync(p.replace('Sr-Case-', 'sr-case-'));
		rmSync(p, { recursive: true, force: true });
		return ok;
	})();
	it.skipIf(!insensitive)('treats a wrong-case spelling as the same repo', async () => {
		const swapped = realRepo.replace('Work', 'WORK');
		const c = await store.addComment(swapped, input('case'));
		expect((await store.listComments(realRepo)).some((x) => x.id === c.id)).toBe(true);
	});
});
