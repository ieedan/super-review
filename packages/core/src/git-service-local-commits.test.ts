import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { getLastCommit, listLocalCommits } from './git-service.js';

// listLocalCommits backs the commit box's summary of what's waiting to be
// pushed: the commits that exist only locally, each with its line counts and
// touched files. The line counts and the add/delete/rename codes come from two
// separate `git log` passes (git honors only the last of --numstat /
// --name-status), so these tests are mostly about the two lining up.

let repo: string;
let remote: string;
let git: SimpleGit;

async function write(rel: string, contents: string): Promise<void> {
	const abs = path.join(repo, rel);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, contents);
}

async function commitFile(rel: string, contents: string, message: string): Promise<void> {
	await write(rel, contents);
	await git.add('.');
	await git.commit(message);
}

beforeEach(async () => {
	repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-local-commits-'));
	git = simpleGit(repo);
	await git.init();
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
});

afterEach(async () => {
	await fs.rm(repo, { recursive: true, force: true });
	if (remote) await fs.rm(remote, { recursive: true, force: true });
});

// A bare remote with the current branch pushed to it, so everything committed
// after this point is local-only.
async function pushEverything(): Promise<void> {
	remote = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-local-commits-remote-'));
	await simpleGit(remote).init(true);
	await git.addRemote('origin', remote);
	const branch = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	await git.push(['-u', 'origin', branch]);
}

describe('listLocalCommits', () => {
	it('lists only the commits missing from the remote, newest first', async () => {
		await commitFile('a.ts', 'export const a = 1;\n', 'init');
		await pushEverything();
		await commitFile('a.ts', 'export const a = 2;\n', 'feat: bump a');
		await commitFile('b.ts', 'export const b = 1;\n', 'feat: add b');

		const commits = await listLocalCommits(repo);
		expect(commits.map((c) => c.subject)).toEqual(['feat: add b', 'feat: bump a']);
		// The same set getLastCommit counts for the row's label.
		expect((await getLastCommit(repo))?.unpushedCount).toBe(2);
	});

	it('carries the line counts and touched files for a commit', async () => {
		await commitFile('a.ts', 'one\ntwo\nthree\n', 'init');
		await pushEverything();
		await write('a.ts', 'one\ntwo\n');
		await write('nested/new.ts', 'fresh\n');
		await git.add('.');
		await git.commit('chore: shuffle');

		const [commit] = await listLocalCommits(repo);
		expect(commit.additions).toBe(1);
		expect(commit.deletions).toBe(1);
		expect(commit.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'a.ts', status: 'modified', deletions: 1 }),
				expect.objectContaining({ path: 'nested/new.ts', status: 'added', additions: 1 })
			])
		);
	});

	it('reports a rename under its new path', async () => {
		await commitFile('src/old.ts', 'export const a = 1;\n', 'init');
		await pushEverything();
		await git.raw(['mv', 'src/old.ts', 'src/new.ts']);
		await git.commit('refactor: rename');

		const [commit] = await listLocalCommits(repo);
		// `git log --numstat` writes this as `src/{old.ts => new.ts}`.
		expect(commit.files).toEqual([
			expect.objectContaining({ path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed' })
		]);
	});

	it('is empty when everything has been pushed', async () => {
		await commitFile('a.ts', 'export const a = 1;\n', 'init');
		await pushEverything();

		expect(await listLocalCommits(repo)).toEqual([]);
	});

	it('is empty on an unborn HEAD', async () => {
		expect(await listLocalCommits(repo)).toEqual([]);
	});

	it('treats every commit as local when there is no remote at all', async () => {
		await commitFile('a.ts', 'export const a = 1;\n', 'init');
		await commitFile('a.ts', 'export const a = 2;\n', 'feat: bump a');

		expect((await listLocalCommits(repo)).map((c) => c.subject)).toEqual(['feat: bump a', 'init']);
	});

	it('caps the list at the requested limit', async () => {
		await commitFile('a.ts', '1\n', 'one');
		await commitFile('a.ts', '2\n', 'two');
		await commitFile('a.ts', '3\n', 'three');

		expect(await listLocalCommits(repo, 2)).toHaveLength(2);
	});
});
