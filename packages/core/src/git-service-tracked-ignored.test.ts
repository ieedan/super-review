import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { stageFile, commit } from './git-service.js';

// Regression coverage for tracked-but-ignored files: a file committed before its
// directory was added to .gitignore stays tracked and keeps showing up as a
// change, but a plain `git add <path>` on it fails with "paths are ignored by one
// of your .gitignore files". stageFile/commit must force past that check rather
// than surface the raw git error. See isIgnoredPathAdd in git-service.ts.

let repo: string;
let git: SimpleGit;

async function write(rel: string, contents: string): Promise<void> {
	const abs = path.join(repo, rel);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, contents);
}

async function status(rel: string): Promise<string> {
	// Two-char porcelain status for a single path (e.g. "D ", " M", "??").
	const out = await git.raw(['status', '--porcelain', '--', rel]);
	return out.slice(0, 2);
}

beforeEach(async () => {
	repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-ignored-'));
	git = simpleGit(repo);
	await git.init();
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	// Commit a file, THEN ignore its whole directory — the file is now tracked
	// yet covered by a .gitignore rule (the state PR #167 left `.super-review` in).
	await write('.super-review/sessions/foo.json', '{"a":1}\n');
	await write('keep.ts', 'export const a = 1;\n');
	await git.add('.');
	await git.commit('init');
	await write('.gitignore', '.super-review\n');
	await git.add('.gitignore');
	await git.commit('ignore super-review');
});

afterEach(async () => {
	await fs.rm(repo, { recursive: true, force: true });
});

describe('stageFile on a tracked-but-ignored path', () => {
	it('stages a modification instead of throwing the .gitignore error', async () => {
		await write('.super-review/sessions/foo.json', '{"a":2}\n');
		await expect(stageFile(repo, '.super-review/sessions/foo.json')).resolves.toBeUndefined();
		expect(await status('.super-review/sessions/foo.json')).toBe('M ');
	});

	it('stages a deletion instead of throwing the .gitignore error', async () => {
		await fs.rm(path.join(repo, '.super-review/sessions/foo.json'));
		await expect(stageFile(repo, '.super-review/sessions/foo.json')).resolves.toBeUndefined();
		expect(await status('.super-review/sessions/foo.json')).toBe('D ');
	});
});

describe('commit on a tracked-but-ignored path', () => {
	it('commits a deletion of the tracked-but-ignored file', async () => {
		await fs.rm(path.join(repo, '.super-review/sessions/foo.json'));
		const result = await commit(repo, 'remove foo', [{ path: '.super-review/sessions/foo.json' }]);
		expect(result.ok).toBe(true);
		// The file is gone from HEAD and the working tree is clean of it.
		await expect(
			git.raw(['cat-file', '-e', 'HEAD:.super-review/sessions/foo.json'])
		).rejects.toBeTruthy();
	});

	it('commits a modification alongside a normal file without a partial patch', async () => {
		await write('.super-review/sessions/foo.json', '{"a":3}\n');
		await write('keep.ts', 'export const a = 2;\n');
		const result = await commit(repo, 'touch both', [
			{ path: '.super-review/sessions/foo.json' },
			{ path: 'keep.ts' }
		]);
		expect(result.ok).toBe(true);
		const head = await git.raw(['show', 'HEAD:.super-review/sessions/foo.json']);
		expect(head).toBe('{"a":3}\n');
	});

	it('commits a tracked-but-ignored change through the partial-commit path', async () => {
		// A second file staged as a hunk forces commit() down commitPartial's
		// scratch-index branch, where the whole-file entry is added by pathspec too.
		await write('.super-review/sessions/foo.json', '{"a":4}\n');
		await write('keep.ts', 'export const a = 1;\nexport const b = 2;\n');
		const patch = await git.diff(['--', 'keep.ts']);
		const result = await commit(repo, 'partial + ignored', [
			{ path: '.super-review/sessions/foo.json' },
			{ path: 'keep.ts', patch }
		]);
		expect(result.ok).toBe(true);
		const head = await git.raw(['show', 'HEAD:.super-review/sessions/foo.json']);
		expect(head).toBe('{"a":4}\n');
	});
});
