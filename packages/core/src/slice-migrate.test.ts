import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateSessionsToSlices, sessionToSlice } from './slice-migrate';
import { listSlices, getSlice } from './slice-store';
import type { Session } from './types';

const legacySession: Session = {
	id: 'sess-1',
	repoId: 'repo-abc',
	key: 'run-9',
	name: 'Old session',
	description: 'frozen one',
	harness: 'claude-code',
	branch: 'feature',
	baseRef: 'deadbeef',
	createdAt: 1000,
	updatedAt: 2000,
	fileCount: 1,
	additions: 5,
	deletions: 2,
	stepCount: 1,
	steps: [
		{
			id: 'step-1',
			title: 'A step',
			body: 'body',
			paths: ['a.ts'],
			callouts: [
				{ id: 'step-1-c1', file: 'a.ts', startLine: 3, endLine: 4, side: 'new', body: 'see here' }
			]
		}
	],
	files: [
		{
			path: 'a.ts',
			status: 'modified',
			additions: 5,
			deletions: 2,
			isBinary: false,
			patch: 'FROZEN PATCH',
			oldContents: 'OLD',
			newContents: 'NEW',
			truncated: false
		}
	]
};

describe('sessionToSlice', () => {
	it('keeps paths, steps and callouts but drops all content', () => {
		const slice = sessionToSlice(legacySession);
		expect(slice.id).toBe('sess-1');
		expect(slice.title).toBe('Old session');
		expect(slice.files).toEqual(['a.ts']);
		expect(slice.author).toEqual({ kind: 'agent', name: 'claude-code', harness: 'claude-code' });
		const callout = slice.steps[0].callouts[0];
		expect(callout.anchor.side).toBe('RIGHT');
		expect(callout.anchor.startLine).toBe(3);
		expect(callout.anchor.fingerprint).toBe('');
		// No frozen content leaks into the JSON.
		expect(JSON.stringify(slice)).not.toContain('FROZEN PATCH');
		expect(JSON.stringify(slice)).not.toContain('OLD');
	});
});

describe('migrateSessionsToSlices', () => {
	let repo: string;
	beforeEach(async () => {
		repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-migrate-'));
		const dir = path.join(repo, '.super-review', 'sessions');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, 'sess-1.json'), JSON.stringify(legacySession));
	});
	afterEach(async () => {
		await fs.rm(repo, { recursive: true, force: true });
	});

	it('writes slices, moves originals aside, and is idempotent', async () => {
		const res = await migrateSessionsToSlices(repo);
		expect(res.migrated).toBe(1);
		expect(res.movedTo).toBeTruthy();

		const slices = await listSlices(repo);
		expect(slices).toHaveLength(1);
		expect((await getSlice(repo, 'sess-1'))?.title).toBe('Old session');

		// Original sessions dir was renamed aside, not deleted.
		await expect(fs.access(path.join(repo, '.super-review', 'sessions'))).rejects.toBeTruthy();
		await expect(fs.access(res.movedTo!)).resolves.toBeUndefined();

		// Re-running finds nothing to migrate (dir already moved).
		const again = await migrateSessionsToSlices(repo);
		expect(again.migrated).toBe(0);
	});
});
