import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { commit } from './git-service.js';

// `git commit -- <path>` aborts the whole commit with "pathspec ... did not
// match any file(s) known to git" when a selected path is in none of HEAD, the
// index, or the worktree. A selection can go stale that way (a file moved or
// deleted after the list loaded, or a rename whose old side never reached
// HEAD), so commit() drops such paths and commits the rest.

let root: string;
let repo: string;
let git: SimpleGit;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-commit-phantom-'));
	repo = path.join(root, 'repo');
	await fs.mkdir(repo);
	git = simpleGit(repo);
	await git.init(['-b', 'main']);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	await fs.writeFile(path.join(repo, 'seed.txt'), 'seed\n');
	await git.add('.');
	await git.commit('init');
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

const file = (p: string, status: 'added' | 'modified' | 'untracked' = 'untracked') =>
	({ path: p, status }) as never;

describe('commit with a selected path git does not know', () => {
	it('commits the real files and ignores the phantom one', async () => {
		const dir = 'routes/(authed)/inventory/settings/manufactures';
		await fs.mkdir(path.join(repo, dir), { recursive: true });
		await fs.writeFile(path.join(repo, dir, '+page.svelte'), '<p/>\n');

		const result = await commit(repo, 'move page', [
			file(`${dir}/+page.svelte`),
			file(`${dir}/+page.server.ts`)
		]);

		expect(result.ok).toBe(true);
		const files = (await git.raw(['show', '--name-only', '--format=', 'HEAD'])).trim();
		expect(files).toBe(`${dir}/+page.svelte`);
	});

	it('reports nothing to commit when every selected path is unknown', async () => {
		const result = await commit(repo, 'nothing', [file('ghost.txt')]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/nothing to commit/i);
	});

	it('still commits a rename whose old side is only in the index', async () => {
		await fs.mkdir(path.join(repo, 'new'));
		await git.mv('seed.txt', 'new/seed.txt');
		const result = await commit(repo, 'rename', [
			{ path: 'new/seed.txt', oldPath: 'seed.txt', status: 'renamed' } as never
		]);
		expect(result.ok).toBe(true);
		expect((await git.status()).isClean()).toBe(true);
	});
});
