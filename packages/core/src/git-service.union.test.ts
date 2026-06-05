import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { getDiff, listChangedFiles } from './git-service';
import type { DiffContext } from './types';

const exec = promisify(execFile);

// A throwaway git repo: fork point on `main`, a branch that both commits a change
// and leaves an uncommitted edit. The union context should surface both in one
// pass — that's exactly what a slice renders over.
let repo: string;

async function git(...args: string[]): Promise<string> {
	const { stdout } = await exec('git', args, { cwd: repo });
	return stdout;
}

beforeAll(async () => {
	repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-union-'));
	await git('init', '-b', 'main');
	await git('config', 'user.email', 'test@example.com');
	await git('config', 'user.name', 'Test');
	// The environment enforces commit signing globally via a signing server that
	// isn't reachable from a throwaway repo; turn it off locally so commits work.
	await git('config', 'commit.gpgsign', 'false');
	await git('config', 'tag.gpgsign', 'false');

	await fs.writeFile(path.join(repo, 'base.txt'), 'base line\n');
	await git('add', '.');
	await git('commit', '--no-gpg-sign', '-m', 'fork point');

	await git('checkout', '-b', 'feature');
	// A change that gets committed on the branch.
	await fs.writeFile(path.join(repo, 'committed.txt'), 'committed change\n');
	await git('add', '.');
	await git('commit', '--no-gpg-sign', '-m', 'committed work');
	// A change left only in the working tree.
	await fs.writeFile(path.join(repo, 'working.txt'), 'uncommitted change\n');
});

afterAll(async () => {
	if (repo) await fs.rm(repo, { recursive: true, force: true });
});

const union: DiffContext = { kind: 'union', base: 'main', head: 'HEAD' };

describe('union diff mode', () => {
	it('lists both committed and uncommitted branch changes in one call', async () => {
		const files = await listChangedFiles(repo, union);
		const paths = files.map((f) => f.path).sort();
		expect(paths).toEqual(['committed.txt', 'working.txt']);
		// base.txt is unchanged since the fork point — it must not appear.
		expect(paths).not.toContain('base.txt');
	});

	it('returns a live patch for a file committed on the branch', async () => {
		const diff = await getDiff(repo, 'committed.txt', union);
		expect(diff.file.status).toBe('added');
		expect(diff.newContents).toBe('committed change\n');
		expect(diff.patch).toContain('committed change');
	});

	it('returns a live patch for a file only edited in the working tree', async () => {
		const diff = await getDiff(repo, 'working.txt', union);
		expect(diff.file.status).toBe('added');
		expect(diff.newContents).toBe('uncommitted change\n');
		expect(diff.patch).toContain('uncommitted change');
	});

	it('reflects a fresh working-tree edit to a committed file immediately', async () => {
		await fs.writeFile(path.join(repo, 'committed.txt'), 'committed change\nplus more\n');
		const diff = await getDiff(repo, 'committed.txt', union);
		expect(diff.newContents).toBe('committed change\nplus more\n');
		expect(diff.patch).toContain('plus more');
		// Restore so other assertions on ordering stay stable if reordered.
		await fs.writeFile(path.join(repo, 'committed.txt'), 'committed change\n');
	});
});
