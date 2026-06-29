// Smoke harness for the resolve-comments skill.
//
// Real review comments are written by the Super Review desktop app into a
// per-machine SQLite database (~/.super-review/comments.db). There is no CLI
// command to *create* one, so to exercise the agent workflow without the app we
// seed a couple of comments directly, then drive the published CLI exactly the
// way the skill tells an agent to: list the unresolved comments, reply, resolve,
// and confirm the queue drains.
//
// Run it with:  node --experimental-sqlite .agents/skills/resolve-comments/smoke.mjs
// It builds its own throwaway git repo and seeds comments scoped to that repo
// path, so it never touches comments for any real repo you review.

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const APP_DB = path.join(homedir(), '.super-review', 'comments.db');

// `super-review` resolves to the published CLI via npx. Override with SR_CLI to
// point at a local build, e.g. SR_CLI="node packages/cli/dist/bin.mjs".
const CLI = (process.env.SR_CLI ?? 'npx -y super-review').split(' ');

function sr(args, opts = {}) {
	const [cmd, ...base] = CLI;
	return execFileSync(cmd, [...base, ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		...opts
	}).trim();
}

function git(repo, args) {
	return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

// 1. A throwaway repo on a feature branch, so the seeded comments have a branch
//    head for the CLI to match against.
const repo = mkdtempSync(path.join(tmpdir(), 'sr-smoke-'));
git(repo, ['init', '-q']);
git(repo, ['config', 'user.email', 't@t.co']);
git(repo, ['config', 'user.name', 'tester']);
writeFileSync(path.join(repo, 'math.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
git(repo, ['add', '-A']);
git(repo, ['commit', '-qm', 'init']);
git(repo, ['checkout', '-q', '-b', 'feature']);
writeFileSync(path.join(repo, 'math.js'), 'export function add(a, b) {\n  return a - b;\n}\n');
git(repo, ['add', '-A']);
git(repo, ['commit', '-qm', 'feature work']);

// 2. Seed two open comments straight into the app database (what the desktop app
//    would have written). One on the working tree, one anchored to the branch.
mkdirSync(path.dirname(APP_DB), { recursive: true });
const db = new DatabaseSync(APP_DB);
db.exec(`CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, repo TEXT NOT NULL, context_key TEXT NOT NULL, path TEXT NOT NULL,
  side TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, body TEXT NOT NULL,
  author TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  in_reply_to TEXT, resolved_at INTEGER, resolved_by TEXT, resolved_session_id TEXT);`);
const now = Date.now();
const author = JSON.stringify({ kind: 'human', name: 'Reviewer' });
const id1 = randomUUID();
const id2 = randomUUID();
const insert = db.prepare(
	`INSERT INTO comments (id,repo,context_key,path,side,start_line,end_line,body,author,created_at,updated_at)
	 VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);
insert.run(id1, repo, 'workingTree', 'math.js', 'RIGHT', 2, 2, 'This subtracts instead of adding.', author, now, now);
insert.run(id2, repo, 'branch:main..feature', 'math.js', 'RIGHT', 2, 2, 'Add a guard for non-number args.', author, now + 1, now + 1);
db.close();

// 3. Drive the workflow the skill documents.
let failed = false;
const check = (label, ok, detail) => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
	if (!ok) failed = true;
};

const open = sr(['comment', 'list', '--unresolved', '--cwd', repo]);
check('list --unresolved shows both seeded comments', open.includes(id1) && open.includes(id2));

const replyOut = sr(['comment', 'reply', id1, '--harness', 'claude-code', 'Restored the + operator.', '--cwd', repo]);
check('reply posts to the thread', replyOut.startsWith('replied to comment'));

check('resolve id1', sr(['comment', 'resolve', id1, '--harness', 'claude-code', '--cwd', repo]).includes('resolved comment'));
check('resolve id2', sr(['comment', 'resolve', id2, '--harness', 'claude-code', '--name', 'Claude', '--cwd', repo]).includes('resolved comment'));

const after = sr(['comment', 'list', '--unresolved', '--cwd', repo]);
check('queue drained', after.includes('no unresolved comments'), after);

// 4. Clean up the throwaway repo and its seeded rows.
const cleanup = new DatabaseSync(APP_DB);
cleanup.prepare('DELETE FROM comments WHERE repo = ?').run(repo);
cleanup.close();
rmSync(repo, { recursive: true, force: true });

console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
process.exit(failed ? 1 : 0);
