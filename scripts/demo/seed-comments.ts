import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { REPO_ROOT } from './lib.ts';

// @libsql/client is a workspace-package dependency (core/cli), not a root one,
// so it is not resolvable from a script at the repo root. Resolve it out of the
// core package the way that package would, and load its CommonJS entry. Done
// lazily inside the seeder so the common scenes never load the native driver.
function loadLibsql(): typeof import('@libsql/client') {
	const require = createRequire(path.join(REPO_ROOT, 'packages', 'core', 'package.json'));
	return require('@libsql/client') as typeof import('@libsql/client');
}

// Optional rehearsal helper: pre-write the review comments the "comments" scene
// would otherwise be left live on camera. Comments live in the per-machine
// application database (~/.super-review/comments.db), keyed by the repo's
// absolute path, so they never travel inside the demo repo; this seeds them
// straight into that database for the seeded repo's path.
//
// The real take should leave the comments live: writing them on camera is the
// point of the comments feature. This exists so a dry run can jump straight to
// the resolve step.

// The four planted review comments, each anchored on the line a reviewer would
// actually click. Paths and lines match the committed feat/settle-up files.
const COMMENTS: { path: string; startLine: number; endLine?: number; body: string }[] = [
	{
		path: 'src/lib/settle.ts',
		startLine: 54,
		endLine: 55,
		body: '`owed` is already integer cents here (the min of two integer balances). Rounding it out to major units and back reintroduces the exact float error the rest of the money code avoids. Can this just be `const amount = owed`?'
	},
	{
		path: 'src/lib/split.ts',
		startLine: 45,
		body: 'Each share rounds on its own, so the parts can miss the total by a cent: three equal shares of 1000 give 333 + 333 + 333 = 999. `equalSplit` hands out the remainder to stay exact; `shares` should too.'
	},
	{
		path: 'src/lib/money.ts',
		startLine: 26,
		body: "`Math.trunc` silently drops a third decimal, so `parseAmount('1.005')` returns 100 rather than rejecting the input. Should a sub-cent amount round, or be refused at the form?"
	},
	{
		path: 'src/lib/components/SettleUpSheet.svelte',
		startLine: 29,
		body: 'This `{#each}` is unkeyed. The transfer list is recomputed from scratch on every settle, so without a key Svelte will reuse the wrong rows. Key it by `from + to`.'
	}
];

const REVIEWER = { kind: 'human' as const, name: 'Sam Rivera' };

function dbPath(): string {
	return path.join(homedir(), '.super-review', 'comments.db');
}

export async function seedComments(out: string): Promise<number> {
	const repo = path.resolve(out);
	// The branch review of feat/settle-up against main. Matches diffContextKey.
	const contextKey = 'branch:main..feat/settle-up';

	const { createClient } = loadLibsql();
	const client = createClient({ url: `file:${dbPath().replace(/\\/g, '/')}` });
	// The app creates this table on first launch; create it here too so seeding
	// works before the app has ever opened.
	await client.execute(`
		CREATE TABLE IF NOT EXISTS comments (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			context_key TEXT NOT NULL,
			path TEXT NOT NULL,
			side TEXT NOT NULL,
			start_line INTEGER NOT NULL,
			end_line INTEGER NOT NULL,
			body TEXT NOT NULL,
			author TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			in_reply_to TEXT,
			resolved_at INTEGER,
			resolved_by TEXT,
			resolved_session_id TEXT
		);
	`);

	// Clear any prior seed for this repo+context so re-running is idempotent.
	await client.execute({
		sql: 'DELETE FROM comments WHERE repo = ? AND context_key = ?',
		args: [repo, contextKey]
	});

	const now = Date.now();
	let i = 0;
	for (const c of COMMENTS) {
		await client.execute({
			sql: `INSERT INTO comments
				(id, repo, context_key, path, side, start_line, end_line, body, author, created_at, updated_at)
				VALUES (?, ?, ?, ?, 'RIGHT', ?, ?, ?, ?, ?, ?)`,
			args: [
				randomUUID(),
				repo,
				contextKey,
				c.path,
				c.startLine,
				c.endLine ?? c.startLine,
				c.body,
				JSON.stringify(REVIEWER),
				// Stagger timestamps a minute apart so the sidebar orders them the
				// way they are listed here.
				now + i * 60_000,
				now + i * 60_000
			]
		});
		i += 1;
	}

	client.close();
	return COMMENTS.length;
}
