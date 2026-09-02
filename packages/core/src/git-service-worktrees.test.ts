import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { listBranches, listChangedFiles, isWorkingTreeDirty } from './git-service.js';

// A linked worktree inside the repo (Claude Code puts them under
// `.claude/worktrees/`) used to break the app in two ways: the worktree's
// branch appeared as a plain branch and `git checkout` on it failed with
// "already used by worktree", and the worktree directory itself showed up as an
// untracked "changed file" with no diffable content. listBranches now reports
// which worktree owns a branch, and the collapsed `?? dir/` status entry is
// filtered out of the file list and the dirty check.

let root: string;
let repo: string;
let worktree: string;
let git: SimpleGit;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-worktrees-'));
	repo = path.join(root, 'repo');
	await fs.mkdir(repo);
	git = simpleGit(repo);
	await git.init(['-b', 'main']);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	await fs.writeFile(path.join(repo, 'a.txt'), 'base\n');
	await git.add('.');
	await git.commit('init');
	await git.branch(['feature']);
	worktree = path.join(repo, '.claude', 'worktrees', 'agent-x');
	await git.raw(['worktree', 'add', worktree, '-b', 'worktree-agent-x']);
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe('branches checked out in linked worktrees', () => {
	it('reports the worktree path on the branch, and only there', async () => {
		const branches = await listBranches(repo);
		const byName = new Map(branches.map((b) => [b.name, b]));

		const agent = byName.get('worktree-agent-x');
		expect(agent?.worktreePath).toBeDefined();
		// realpath both sides: on macOS the tmpdir is reached via the /var →
		// /private/var symlink and git reports the resolved path.
		expect(await fs.realpath(agent!.worktreePath!)).toBe(await fs.realpath(worktree));

		// The branch checked out here is `current`, not a foreign worktree; a
		// plain branch has no worktree at all.
		expect(byName.get('main')).toMatchObject({ current: true, worktreePath: undefined });
		expect(byName.get('feature')?.worktreePath).toBeUndefined();
	});

	it('seen from the worktree, the main checkout is the foreign worktree', async () => {
		const branches = await listBranches(worktree);
		const byName = new Map(branches.map((b) => [b.name, b]));
		expect(byName.get('worktree-agent-x')?.current).toBe(true);
		expect(byName.get('worktree-agent-x')?.worktreePath).toBeUndefined();
		expect(byName.get('main')?.worktreePath).toBeDefined();
	});
});

describe('worktree directory in the working-tree status', () => {
	it('is not listed as a changed file and does not count as dirty', async () => {
		// git collapses the embedded worktree to a single `?? .claude/` entry —
		// nothing the app can diff or stage.
		const files = await listChangedFiles(repo, { kind: 'workingTree' });
		expect(files).toEqual([]);
		expect(await isWorkingTreeDirty(repo)).toBe(false);
	});

	it('still lists real changes alongside it', async () => {
		await fs.writeFile(path.join(repo, 'b.txt'), 'new\n');
		const files = await listChangedFiles(repo, { kind: 'workingTree' });
		expect(files.map((f) => f.path)).toEqual(['b.txt']);
		expect(await isWorkingTreeDirty(repo)).toBe(true);
	});
});
