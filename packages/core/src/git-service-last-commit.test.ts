import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { commit as gitCommit, getLastCommit, undoLastCommit } from './git-service.js';

// getLastCommit carries the tip commit's full message (subject + body) so the
// commit box can restore it the moment Undo is pressed, with no round-trip. The
// body comes last in the pretty-format for that reason: it's the only field that
// can contain newlines.

const SEP = '\x1f';

let repo: string;
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
	repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-last-commit-'));
	git = simpleGit(repo);
	await git.init();
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
});

afterEach(async () => {
	await fs.rm(repo, { recursive: true, force: true });
});

describe('getLastCommit', () => {
	it('splits a multi-paragraph message into subject and body', async () => {
		await commitFile('a.ts', 'export const a = 1;\n', 'init');
		await commitFile(
			'a.ts',
			'export const a = 2;\n',
			'feat: do the thing\n\nWhy it matters.\n\nSecond paragraph.'
		);

		const last = await getLastCommit(repo);
		expect(last?.subject).toBe('feat: do the thing');
		expect(last?.body).toBe('Why it matters.\n\nSecond paragraph.');
	});

	it('reports an empty body for a subject-only commit', async () => {
		await commitFile('a.ts', 'export const a = 1;\n', 'chore: add a');

		const last = await getLastCommit(repo);
		expect(last?.subject).toBe('chore: add a');
		expect(last?.body).toBe('');
	});

	it('keeps a body containing the field separator intact', async () => {
		await commitFile(
			'a.ts',
			'export const a = 1;\n',
			`fix: strip control chars\n\nBefore${SEP}after.`
		);

		const last = await getLastCommit(repo);
		expect(last?.body).toBe(`Before${SEP}after.`);
	});

	it('returns null on an unborn HEAD', async () => {
		expect(await getLastCommit(repo)).toBeNull();
	});
});

describe('undoLastCommit', () => {
	it('keeps the undone changes staged and reports the exposed commit', async () => {
		await commitFile('a.ts', 'export const a = 1;\n', 'init');
		await commitFile('a.ts', 'export const a = 2;\n', 'feat: bump a');

		const result = await undoLastCommit(repo);
		expect(result.ok).toBe(true);
		// Reported inline so the caller needn't wait on a refresh to update its row.
		expect(result.lastCommit?.subject).toBe('init');
		expect((await git.raw(['status', '--porcelain', '--', 'a.ts'])).slice(0, 2)).toBe('M ');
		expect((await getLastCommit(repo))?.subject).toBe('init');
	});

	it('keeps the files staged when undoing the only commit', async () => {
		await commitFile('a.ts', 'export const a = 1;\n', 'feat: first');

		const result = await undoLastCommit(repo);
		expect(result.ok).toBe(true);
		// HEAD is unborn again: null, not a stale commit.
		expect(result.lastCommit).toBeNull();
		expect((await git.raw(['status', '--porcelain', '--', 'a.ts'])).slice(0, 2)).toBe('A ');
		expect(await getLastCommit(repo)).toBeNull();
	});

	it('fails cleanly with nothing to undo', async () => {
		expect((await undoLastCommit(repo)).ok).toBe(false);
	});
});

describe('commit', () => {
	it('reports the commit it just made', async () => {
		await commitFile('a.ts', 'export const a = 1;\n', 'init');
		await write('b.ts', 'export const b = 1;\n');

		const result = await gitCommit(repo, 'feat: add b\n\nWith a body.', [{ path: 'b.ts' }]);
		expect(result.ok).toBe(true);
		expect(result.lastCommit?.subject).toBe('feat: add b');
		expect(result.lastCommit?.body).toBe('With a body.');
		expect(result.lastCommit?.hash).toBe((await getLastCommit(repo))?.hash);
	});
});
