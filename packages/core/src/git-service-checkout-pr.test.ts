import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { checkoutPR } from './git-service.js';

// A PR whose head branch was deleted after merge (GitHub's default cleanup) can
// still be reviewed: the base repo keeps `refs/pull/<n>/head` forever. Checking
// it out used to fail with "couldn't find remote ref <branch>" because we only
// ever fetched the head branch by name. checkoutPR must fall back to the
// pull ref instead.

let remote: string; // bare repo standing in for GitHub
let repo: string; // the clone the app operates on
let git: SimpleGit;

beforeEach(async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-checkout-pr-'));
	remote = path.join(root, 'remote.git');
	repo = path.join(root, 'clone');

	const seed = path.join(root, 'seed');
	await fs.mkdir(seed, { recursive: true });
	const seedGit = simpleGit(seed);
	await seedGit.init();
	await seedGit.addConfig('user.email', 'test@example.com');
	await seedGit.addConfig('user.name', 'Test');
	await fs.writeFile(path.join(seed, 'a.txt'), 'base\n');
	await seedGit.add('.');
	await seedGit.commit('init');
	await seedGit.checkoutLocalBranch('chore/cleanups');
	await fs.writeFile(path.join(seed, 'a.txt'), 'pr work\n');
	await seedGit.add('.');
	await seedGit.commit('pr commit');
	const headSha = (await seedGit.revparse(['HEAD'])).trim();
	await seedGit.checkout('main').catch(() => seedGit.checkout('master'));

	await simpleGit(root).raw(['clone', '--bare', seed, remote]);
	// The PR's head branch is deleted (post-merge cleanup) but GitHub's
	// refs/pull/<n>/head snapshot survives.
	const bare = simpleGit(remote);
	await bare.raw(['update-ref', 'refs/pull/7/head', headSha]);
	await bare.raw(['update-ref', '-d', 'refs/heads/chore/cleanups']);

	await simpleGit(root).raw(['clone', remote, repo]);
	git = simpleGit(repo);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
});

afterEach(async () => {
	await fs.rm(path.resolve(repo, '..'), { recursive: true, force: true });
});

describe('checkoutPR', () => {
	it('falls back to pull/<n>/head when the head branch was deleted', async () => {
		await checkoutPR(repo, {
			prNumber: 7,
			headRef: 'chore/cleanups',
			// The head repo still exists — only its branch is gone, which is the
			// case that previously threw.
			headRepoUrl: remote,
			headRepoOwner: 'someone',
			originUrl: remote,
			fallbackRemote: 'origin'
		});

		expect((await git.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('chore/cleanups');
		expect(await fs.readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('pr work\n');
	});

	it('still fails loudly when the fetch error is not a missing ref', async () => {
		await expect(
			checkoutPR(repo, {
				prNumber: 7,
				headRef: 'chore/cleanups',
				headRepoUrl: path.join(repo, '..', 'does-not-exist.git'),
				headRepoOwner: 'someone',
				originUrl: remote,
				fallbackRemote: 'origin'
			})
		).rejects.toThrow();
	});
});
