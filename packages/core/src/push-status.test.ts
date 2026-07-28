import { describe, expect, it } from 'vitest';
import { canSync, hasCommitsToPush } from './push-status.js';
import type { PushStatus } from './types.js';

function status(overrides: Partial<PushStatus> = {}): PushStatus {
	return {
		branch: 'feat/thing',
		ahead: 0,
		behind: 0,
		hasUpstream: true,
		hasRemote: true,
		aheadOfDefault: 0,
		behindDefault: 0,
		pushRemote: 'origin',
		...overrides
	};
}

describe('hasCommitsToPush', () => {
	it('is false when the branch is level with its upstream', () => {
		expect(hasCommitsToPush(status())).toBe(false);
	});

	it('is false when the branch is only behind', () => {
		expect(hasCommitsToPush(status({ behind: 3 }))).toBe(false);
	});

	it('is true when the branch is ahead', () => {
		expect(hasCommitsToPush(status({ ahead: 1 }))).toBe(true);
		expect(hasCommitsToPush(status({ ahead: 2, behind: 3 }))).toBe(true);
	});

	it('is true without an upstream, since the first push publishes the branch', () => {
		expect(hasCommitsToPush(status({ hasUpstream: false, pushRemote: undefined }))).toBe(true);
	});

	it('is false without a remote or a status', () => {
		expect(hasCommitsToPush(status({ ahead: 5, hasRemote: false }))).toBe(false);
		expect(hasCommitsToPush(null)).toBe(false);
		expect(hasCommitsToPush(undefined)).toBe(false);
	});
});

describe('canSync', () => {
	it('is false when the branch is level with its upstream', () => {
		expect(canSync(status())).toBe(false);
	});

	it('is true when the branch is behind, which the push flow pulls', () => {
		expect(canSync(status({ behind: 3 }))).toBe(true);
	});

	it('is true when the branch is ahead', () => {
		expect(canSync(status({ ahead: 1 }))).toBe(true);
	});

	it('is true without an upstream', () => {
		expect(canSync(status({ hasUpstream: false, pushRemote: undefined }))).toBe(true);
	});

	it('is false without a remote or a status', () => {
		expect(canSync(status({ ahead: 5, behind: 5, hasRemote: false }))).toBe(false);
		expect(canSync(null)).toBe(false);
		expect(canSync(undefined)).toBe(false);
	});
});
