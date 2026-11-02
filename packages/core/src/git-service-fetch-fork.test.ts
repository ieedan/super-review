import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { fetchOrigin } from './git-service.js';

// A branch checked out from a fork PR tracks the fork's remote, not origin.
// fetchOrigin used to fetch only origin, so the fork's tracking ref (and with it
// the behind count and the diff head) froze at the moment of checkout.

let root: string;
let origin: string;
let fork: string;
let clone: string;

async function init(dir: string, bare = false): Promise<SimpleGit> {
	await fs.mkdir(dir, { recursive: true });
	const git = simpleGit(dir);
	await git.init(bare ? ['--bare', '-b', 'main'] : ['-b', 'main']);
	if (!bare) {
		await git.addConfig('user.email', 'test@example.com');
		await git.addConfig('user.name', 'Test');
	}
	return git;
}

async function commit(git: SimpleGit, dir: string, file: string, msg: string): Promise<void> {
	await fs.writeFile(path.join(dir, file), msg);
	await git.add('.');
	await git.commit(msg);
}

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-fetch-fork-'));
	origin = path.join(root, 'origin.git');
	fork = path.join(root, 'fork');
	clone = path.join(root, 'clone');

	await init(origin, true);
	const forkGit = await init(fork);
	await commit(forkGit, fork, 'a.txt', 'one');
	await forkGit.checkoutLocalBranch('feat');
	await commit(forkGit, fork, 'b.txt', 'feat one');

	const git = await init(clone);
	await git.addRemote('origin', origin);
	await git.addRemote('contrib', fork);
	await git.fetch(['contrib']);
	await git.checkout(['-b', 'feat', '--track', 'contrib/feat']);
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe('fetchOrigin', () => {
	it('also refreshes the remote the checked-out branch tracks', async () => {
		const forkGit = simpleGit(fork);
		await commit(forkGit, fork, 'c.txt', 'feat two');
		const tip = (await forkGit.revparse(['HEAD'])).trim();

		const result = await fetchOrigin(clone);

		expect(result.ok).toBe(true);
		expect((await simpleGit(clone).revparse(['contrib/feat'])).trim()).toBe(tip);
	});

	it('does not fail when the tracked fork is unreachable', async () => {
		await fs.rm(fork, { recursive: true, force: true });

		const result = await fetchOrigin(clone);

		expect(result.ok).toBe(true);
	});
});
