import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { cloneRepo } from './git-service.js';

// The clone dialog offers a destination of `<local path>/<repo name>`, which
// often already exists — the user made the folder, or another tool already
// cloned there. git's own rule is the one to mirror: a destination that doesn't
// exist or is an empty directory is fine, anything with an entry in it is not.
// Cloning is done from a local source repo, so these tests need no network.

let root: string;
let source: string;
let dest: string;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-clone-dest-'));
	source = path.join(root, 'source');
	dest = path.join(root, 'dest');
	await fs.mkdir(source);
	await fs.mkdir(dest);
	const git = simpleGit(source);
	await git.init(['-b', 'main']);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	await fs.writeFile(path.join(source, 'README.md'), '# source\n');
	await git.add('.');
	await git.commit('init');
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe('cloneRepo destination handling', () => {
	it('clones when nothing is at the destination', async () => {
		const result = await cloneRepo(source, dest);
		expect(result.ok).toBe(true);
		expect(result.path).toBe(path.join(dest, 'source'));
		await expect(fs.stat(path.join(dest, 'source', 'README.md'))).resolves.toBeTruthy();
	});

	it('clones into a destination folder that exists but is empty', async () => {
		await fs.mkdir(path.join(dest, 'source'));
		const result = await cloneRepo(source, dest);
		expect(result.ok).toBe(true);
		await expect(fs.stat(path.join(dest, 'source', 'README.md'))).resolves.toBeTruthy();
	});

	it('refuses a destination folder that holds anything, and leaves it alone', async () => {
		const target = path.join(dest, 'source');
		await fs.mkdir(target);
		await fs.writeFile(path.join(target, 'notes.txt'), 'mine\n');
		const result = await cloneRepo(source, dest);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/empty folders/);
		expect(await fs.readdir(target)).toEqual(['notes.txt']);
	});

	it('refuses a destination that is a file', async () => {
		await fs.writeFile(path.join(dest, 'source'), 'not a folder\n');
		const result = await cloneRepo(source, dest);
		expect(result.ok).toBe(false);
	});
});
