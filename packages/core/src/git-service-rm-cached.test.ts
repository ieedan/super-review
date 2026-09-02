import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { listChangedFiles } from './git-service.js';

// `git status` lists a path twice when its deletion is staged but the file is
// still on disk (`git rm --cached`): `D  path` and `?? path`. The renderer keys
// the file list by path, so two entries for one path crashed it with
// each_key_duplicate (seen in a repo with 99 staged deletions, six of which had
// been re-created on disk). The working-tree lister folds the pair into one
// modified row.

let root: string;
let repo: string;
let git: SimpleGit;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-rm-cached-'));
	repo = path.join(root, 'repo');
	await fs.mkdir(repo);
	git = simpleGit(repo);
	await git.init(['-b', 'main']);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	await fs.writeFile(path.join(repo, 'kept.txt'), 'a\nb\n');
	await fs.writeFile(path.join(repo, 'gone.txt'), 'x\n');
	await git.add('.');
	await git.commit('init');
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe('listChangedFiles with a staged deletion whose file is still on disk', () => {
	it('lists the path once, as a modification of HEAD', async () => {
		await git.rm(['--cached', 'kept.txt']);
		await fs.writeFile(path.join(repo, 'kept.txt'), 'a\nb\nc\n');
		// A plain staged deletion alongside, to make sure it is untouched.
		await git.rm(['gone.txt']);

		const files = await listChangedFiles(repo, { kind: 'workingTree' });
		const paths = files.map((f) => f.path);
		expect(new Set(paths).size).toBe(paths.length);
		expect(paths.sort()).toEqual(['gone.txt', 'kept.txt']);

		const kept = files.find((f) => f.path === 'kept.txt')!;
		expect(kept.status).toBe('modified');
		// Staged half removes both HEAD lines; unstaged half re-adds the three on
		// disk. The content sig comes from the on-disk bytes.
		expect(kept.deletions).toBe(2);
		expect(kept.additions).toBe(3);
		expect(kept.isBinary).toBe(false);
		expect(kept.contentSig).toBeTruthy();

		const gone = files.find((f) => f.path === 'gone.txt')!;
		expect(gone.status).toBe('deleted');
		expect(gone.deletions).toBe(1);
	});

	it('handles a file re-created identical to HEAD', async () => {
		await git.rm(['--cached', 'kept.txt']);
		const files = await listChangedFiles(repo, { kind: 'workingTree' });
		expect(files.filter((f) => f.path === 'kept.txt')).toHaveLength(1);
		expect(files[0].status).toBe('modified');
	});
});
