import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { captureSlice } from './slice-capture';
import { getSlice, writeSlice, findSliceByKey, listSlices } from './slice-store';

const exec = promisify(execFile);

let repo: string;
async function git(...args: string[]): Promise<string> {
	const { stdout } = await exec('git', args, { cwd: repo });
	return stdout;
}

beforeAll(async () => {
	repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-slice-'));
	await git('init', '-b', 'main');
	await git('config', 'user.email', 'test@example.com');
	await git('config', 'user.name', 'Test');
	await git('config', 'commit.gpgsign', 'false');

	await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
	await git('add', '.');
	await git('commit', '--no-gpg-sign', '-m', 'fork point');

	await git('checkout', '-b', 'feature');
	await fs.writeFile(path.join(repo, 'feature.ts'), ['one', 'two', 'three', 'four'].join('\n') + '\n');
	await git('add', '.');
	await git('commit', '--no-gpg-sign', '-m', 'add feature');
});

afterAll(async () => {
	if (repo) await fs.rm(repo, { recursive: true, force: true });
});

describe('captureSlice + slice-store round trip', () => {
	it('persists paths, steps and anchored callouts with zero file content', async () => {
		const slice = await captureSlice(repo, {
			key: 'run-1',
			title: 'My slice',
			description: 'desc',
			author: { kind: 'agent', name: 'claude-code', harness: 'claude-code' },
			steps: [
				{
					title: 'The feature',
					body: 'look here',
					files: ['feature.ts'],
					callouts: [{ file: 'feature.ts', startLine: 2, endLine: 2, side: 'new', body: 'this line' }]
				}
			]
		});
		await writeSlice(repo, slice);

		// On-disk manifest must carry no file content.
		const manifest = await fs.readFile(
			path.join(repo, '.super-review', 'slices', `${slice.id}.json`),
			'utf8'
		);
		expect(manifest).not.toContain('newContents');
		expect(manifest).not.toContain('oldContents');
		expect(manifest).not.toContain('"patch"');

		const loaded = await getSlice(repo, slice.id);
		expect(loaded).not.toBeNull();
		expect(loaded!.files).toEqual(['feature.ts']);
		expect(loaded!.steps).toHaveLength(1);
		expect(loaded!.title).toBe('My slice');

		const callout = loaded!.steps[0].callouts[0];
		expect(callout.anchor.file).toBe('feature.ts');
		expect(callout.anchor.side).toBe('RIGHT');
		expect(callout.anchor.startLine).toBe(2);
		// The fingerprint of "two" must have been captured (non-empty).
		expect(callout.anchor.fingerprint).not.toBe('');
	});

	it('upserts by key instead of duplicating', async () => {
		const existing = await findSliceByKey(repo, 'run-1');
		expect(existing).not.toBeNull();
		const updated = await captureSlice(
			repo,
			{ key: 'run-1', title: 'Renamed slice' },
			existing
		);
		await writeSlice(repo, updated);
		expect(updated.id).toBe(existing!.id);

		const all = await listSlices(repo);
		expect(all).toHaveLength(1);
		expect(all[0].title).toBe('Renamed slice');
		// Carrying the tour over keeps the step.
		const reloaded = await getSlice(repo, updated.id);
		expect(reloaded!.steps).toHaveLength(1);
	});

	it('derives the file scope from the union diff when no files are given', async () => {
		const slice = await captureSlice(repo, { key: 'run-2', title: 'Auto scope' });
		expect(slice.files).toContain('feature.ts');
		expect(slice.files).not.toContain('base.txt');
	});
});
