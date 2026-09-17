import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { createManagedStash, mergeIntoCurrent, restoreManagedStash } from './git-service.js';

// `git stash` cannot snapshot intent-to-add entries (`git add -N`): it fails
// with "Entry '<path>' not uptodate. Cannot merge. Cannot save the current
// worktree state". Agents leave those entries behind, and the raw error used
// to surface in the app whenever a pull needed to stash first or "Update from
// main" ran with `--autostash`. Both paths demote i-t-a entries to plain
// untracked files before stashing, so the user's new file rides along.

let root: string;
let repo: string;
let git: SimpleGit;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-ita-stash-'));
	repo = path.join(root, 'repo');
	await fs.mkdir(repo);
	git = simpleGit(repo);
	await git.init(['-b', 'main']);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	await fs.writeFile(path.join(repo, 'tracked.txt'), 'a\n');
	await git.add('.');
	await git.commit('init');
	// A commit on another branch to merge in, plus dirty local work: one tracked
	// edit and one brand-new file registered with `add -N`.
	await git.checkoutLocalBranch('feature');
	await fs.writeFile(path.join(repo, 'feature.txt'), 'f\n');
	await git.add('.');
	await git.commit('feature');
	await git.checkout('main');
	await fs.writeFile(path.join(repo, 'tracked.txt'), 'a\nb\n');
	await fs.writeFile(path.join(repo, 'new.txt'), 'new\n');
	await git.raw(['add', '-N', 'new.txt']);
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

async function shortStatus(): Promise<string[]> {
	const raw = await git.raw(['status', '--porcelain', '--untracked-files=all']);
	return raw.split('\n').filter(Boolean).sort();
}

describe('stashing with an intent-to-add entry present', () => {
	it('createManagedStash succeeds and the file comes back untracked on restore', async () => {
		const stashed = await createManagedStash(repo, 'main');
		expect(stashed).toEqual({ ok: true });
		expect(await shortStatus()).toEqual([]);

		const sha = (await git.raw(['rev-parse', 'stash@{0}'])).trim();
		const restored = await restoreManagedStash(repo, sha);
		expect(restored.ok).toBe(true);
		expect(await shortStatus()).toEqual([' M tracked.txt', '?? new.txt']);
		expect(await fs.readFile(path.join(repo, 'new.txt'), 'utf8')).toBe('new\n');
	});

	it('mergeIntoCurrent (--autostash) succeeds and keeps the local work', async () => {
		const result = await mergeIntoCurrent(repo, 'feature');
		expect(result).toEqual({ ok: true, conflicts: [] });
		// The fast-forward brought feature.txt in; the edit and the new file are
		// back in the working tree, the latter as a plain untracked file.
		expect(await shortStatus()).toEqual([' M tracked.txt', '?? new.txt']);
		await expect(fs.access(path.join(repo, 'feature.txt'))).resolves.toBeUndefined();
	});
});
