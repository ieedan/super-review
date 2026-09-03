import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { commit, listChangedFiles } from './git-service.js';

// commit() stages its files through one batched `git add` per few hundred
// paths instead of one subprocess per file (a 350-file commit took ~23s that
// way, ~0.2s batched). A batch is all-or-nothing, so these cover the inputs
// that make it fail and fall back to the per-path pass: an already-staged
// rename whose old side no longer matches any pathspec, and a whole-file batch
// riding along with a partial (hunk) selection through the scratch index.

let root: string;
let repo: string;
let git: SimpleGit;

const FILE_COUNT = 120;

function filePath(i: number): string {
	return `src/d${i % 10}/f${i}.ts`;
}

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-commit-batched-'));
	repo = path.join(root, 'repo');
	await fs.mkdir(repo);
	git = simpleGit(repo);
	await git.init(['-b', 'main']);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	for (let i = 0; i < FILE_COUNT; i++) {
		const p = path.join(repo, filePath(i));
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, `line1\nline2\n`);
	}
	await fs.writeFile(path.join(repo, 'old.txt'), 'moved\n');
	await fs.writeFile(path.join(repo, 'part.txt'), 'a\nb\n');
	await git.add('.');
	await git.commit('init');
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe('commit with many whole files', () => {
	it('commits every modified and untracked file and leaves the tree clean', async () => {
		for (let i = 0; i < FILE_COUNT; i++) {
			await fs.writeFile(path.join(repo, filePath(i)), `changed\nline2\n`);
		}
		for (let i = 0; i < 30; i++) {
			await fs.writeFile(path.join(repo, `new${i}.txt`), 'new\n');
		}
		const changed = await listChangedFiles(repo, { kind: 'workingTree' });
		expect(changed).toHaveLength(FILE_COUNT + 30);

		const result = await commit(
			repo,
			'batch',
			changed.map((f) => ({ path: f.path, oldPath: f.oldPath }))
		);
		expect(result.ok).toBe(true);
		expect(result.filesCommitted).toBe(FILE_COUNT + 30);
		expect(await listChangedFiles(repo, { kind: 'workingTree' })).toEqual([]);
		const shown = await git.raw(['show', '--name-only', '--pretty=format:', 'HEAD']);
		expect(shown.split('\n').filter(Boolean)).toHaveLength(FILE_COUNT + 30);
	});

	it('leaves unselected files out of the commit', async () => {
		for (let i = 0; i < FILE_COUNT; i++) {
			await fs.writeFile(path.join(repo, filePath(i)), `changed\nline2\n`);
		}
		const selected = Array.from({ length: FILE_COUNT - 1 }, (_, i) => ({ path: filePath(i) }));
		const result = await commit(repo, 'most', selected);
		expect(result.ok).toBe(true);
		expect(result.filesCommitted).toBe(FILE_COUNT - 1);
		const left = await listChangedFiles(repo, { kind: 'workingTree' });
		expect(left.map((f) => f.path)).toEqual([filePath(FILE_COUNT - 1)]);
	});
});

describe('commit with a rename already staged as a unit', () => {
	// `git mv` stages the rename, so the old side is gone from both the worktree
	// and the index: `git add -- old.txt` reports "did not match any files",
	// which aborts the batched add and must be tolerated path by path.
	it('records the rename alongside other files', async () => {
		await git.mv('old.txt', 'new.txt');
		await fs.writeFile(path.join(repo, filePath(0)), `changed\nline2\n`);
		const result = await commit(repo, 'rename', [
			{ path: 'new.txt', oldPath: 'old.txt' },
			{ path: filePath(0) }
		]);
		expect(result.ok).toBe(true);
		const status = await git.raw(['show', '--name-status', '--pretty=format:', '-M', 'HEAD']);
		expect(status).toMatch(/^R\d*\told\.txt\tnew\.txt$/m);
		expect(status).toMatch(new RegExp(`^M\\t${filePath(0)}$`, 'm'));
		expect(await listChangedFiles(repo, { kind: 'workingTree' })).toEqual([]);
	});
});

describe('partial commit with many whole files alongside', () => {
	it('commits the whole files in full and only the kept hunk of the partial one', async () => {
		for (let i = 0; i < FILE_COUNT; i++) {
			await fs.writeFile(path.join(repo, filePath(i)), `changed\nline2\n`);
		}
		await fs.writeFile(path.join(repo, 'part.txt'), 'a\nX\nb\nY\n');
		// HEAD -> kept subset: only the `X` line, leaving `Y` in the working tree.
		const patch = [
			'diff --git a/part.txt b/part.txt',
			'--- a/part.txt',
			'+++ b/part.txt',
			'@@ -1,2 +1,3 @@',
			' a',
			'+X',
			' b',
			''
		].join('\n');
		const result = await commit(repo, 'partial', [
			...Array.from({ length: FILE_COUNT }, (_, i) => ({ path: filePath(i) })),
			{ path: 'part.txt', patch }
		]);
		expect(result.ok).toBe(true);
		expect(result.filesCommitted).toBe(FILE_COUNT + 1);
		expect(await git.show(['HEAD:part.txt'])).toBe('a\nX\nb\n');
		const left = await listChangedFiles(repo, { kind: 'workingTree' });
		expect(left.map((f) => f.path)).toEqual(['part.txt']);
	});
});
