import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { captureSession } from './session-capture.js';

let repo: string;

async function write(rel: string, contents: string): Promise<void> {
	const abs = path.join(repo, rel);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, contents);
}

beforeEach(async () => {
	repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-capture-'));
	const git = simpleGit(repo);
	await git.init();
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	await write('tracked.ts', 'export const a = 1;\n');
	await git.add('.');
	await git.commit('init');
});

afterEach(async () => {
	await fs.rm(repo, { recursive: true, force: true });
});

describe('captureSession untracked files', () => {
	it('captures a brand new untracked file with real line counts and contents', async () => {
		const body =
			Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
		await write('brand-new.ts', body);
		await write('tracked.ts', 'export const a = 2;\n');

		const session = await captureSession(repo, {
			name: 'test',
			steps: [{ title: 'step', files: ['brand-new.ts', 'tracked.ts'] }]
		});

		const added = session.files.find((f) => f.path === 'brand-new.ts');
		expect(added).toBeDefined();
		expect(added!.status).toBe('added');
		expect(added!.newContents).toBe(body);
		expect(added!.patch).not.toBe('');
		expect(added!.additions).toBe(12);
		expect(added!.deletions).toBe(0);

		// The session-level stat must include the untracked file's lines.
		expect(session.additions).toBe(13);
		expect(session.deletions).toBe(1);
	});

	it('captures an untracked file inside a brand new directory', async () => {
		await write('src/deep/nested.ts', 'one\ntwo\nthree\n');

		const session = await captureSession(repo, {
			name: 'test',
			steps: [{ title: 'step', files: ['src/deep/nested.ts'] }]
		});

		const added = session.files.find((f) => f.path === 'src/deep/nested.ts');
		expect(added?.additions).toBe(3);
		expect(added?.patch).toContain('+++ b/src/deep/nested.ts');
		expect(session.additions).toBe(3);
	});

	it('counts a file added with `git add -N` the same as a fully untracked one', async () => {
		await write('intent.ts', 'a\nb\nc\nd\n');
		await simpleGit(repo).raw(['add', '-N', 'intent.ts']);

		const session = await captureSession(repo, {
			name: 'test',
			steps: [{ title: 'step', files: ['intent.ts'] }]
		});

		expect(session.files.find((f) => f.path === 'intent.ts')?.additions).toBe(4);
		expect(session.additions).toBe(4);
	});

	it('does not count a tracked file whose diff is genuinely empty', async () => {
		// A mode-only change: git reports it as modified, but numstat is 0/0. The
		// untracked fallback must not kick in and report the whole file as added.
		await fs.chmod(path.join(repo, 'tracked.ts'), 0o755);

		const session = await captureSession(repo, {
			name: 'test',
			steps: [{ title: 'step', files: ['tracked.ts'] }]
		});

		expect(session.files.find((f) => f.path === 'tracked.ts')?.additions).toBe(0);
		expect(session.additions).toBe(0);
	});

	it('ignores untracked files excluded by .gitignore', async () => {
		await write('.gitignore', 'ignored.ts\n');
		await write('ignored.ts', 'secret\nlines\n');
		await write('kept.ts', 'kept\n');

		const session = await captureSession(repo, { name: 'test' });

		expect(session.files.map((f) => f.path).sort()).toEqual(['.gitignore', 'kept.ts']);
	});
});
