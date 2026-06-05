import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);

let repo: string;
let home: string;
// The store reads homedir() lazily for its app DB; point HOME at a temp dir
// BEFORE importing it so the test gets its own throwaway database.
let store: typeof import('./comment-store');
let computeFingerprint: typeof import('./anchor').computeFingerprint;

async function git(...args: string[]): Promise<string> {
	const { stdout } = await exec('git', args, { cwd: repo });
	return stdout;
}

beforeAll(async () => {
	home = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-home-'));
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	store = await import('./comment-store');
	computeFingerprint = (await import('./anchor')).computeFingerprint;

	repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-comment-'));
	await git('init', '-b', 'main');
	await git('config', 'user.email', 't@e.com');
	await git('config', 'user.name', 'T');
	await git('config', 'commit.gpgsign', 'false');
	await fs.writeFile(
		path.join(repo, 'file.ts'),
		['committed one', 'committed two'].join('\n') + '\n'
	);
	await git('add', '.');
	await git('commit', '--no-gpg-sign', '-m', 'init');
	// Add a working-tree-only line on top.
	await fs.writeFile(
		path.join(repo, 'file.ts'),
		['committed one', 'committed two', 'working three'].join('\n') + '\n'
	);
});

afterAll(async () => {
	await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
	await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

describe('comment store anchor fields', () => {
	it('persists and reads back the fingerprint', async () => {
		const fp = computeFingerprint(['committed two']);
		const c = await store.addComment(repo, {
			path: 'file.ts',
			side: 'RIGHT',
			startLine: 2,
			endLine: 2,
			fingerprint: fp,
			body: 'note',
			author: { kind: 'human', name: 'me' }
		});
		expect(c.fingerprint).toBe(fp);
		const all = await store.listComments(repo);
		expect(all.find((x) => x.id === c.id)?.fingerprint).toBe(fp);
	});

	it('treats a committed line as committable and a working-tree-only line as not', async () => {
		const committed = await store.addComment(repo, {
			path: 'file.ts',
			side: 'RIGHT',
			startLine: 2,
			endLine: 2,
			fingerprint: computeFingerprint(['committed two']),
			body: 'on committed line',
			author: { kind: 'human', name: 'me' }
		});
		const working = await store.addComment(repo, {
			path: 'file.ts',
			side: 'RIGHT',
			startLine: 3,
			endLine: 3,
			fingerprint: computeFingerprint(['working three']),
			body: 'on working line',
			author: { kind: 'human', name: 'me' }
		});
		expect(await store.isCommittable(repo, committed)).toBe(true);
		expect(await store.isCommittable(repo, working)).toBe(false);
	});

	it('records a github binding only when set', async () => {
		const c = await store.addComment(repo, {
			path: 'file.ts',
			side: 'RIGHT',
			startLine: 1,
			endLine: 1,
			fingerprint: computeFingerprint(['committed one']),
			body: 'bind me',
			author: { kind: 'human', name: 'me' }
		});
		expect(c.githubBinding).toBeUndefined();
		const bound = await store.bindCommentToGithub(repo, c.id, {
			commitSHA: 'abc123',
			reviewCommentId: 99
		});
		expect(bound?.githubBinding).toEqual({ commitSHA: 'abc123', reviewCommentId: 99 });
		const reloaded = (await store.listComments(repo)).find((x) => x.id === c.id);
		expect(reloaded?.githubBinding).toEqual({ commitSHA: 'abc123', reviewCommentId: 99 });
	});
});
