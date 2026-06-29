import { describe, expect, it } from 'vitest';
import { localCommentOutdated } from './comment-outdated';

const right = { side: 'RIGHT' as const, startLine: 10 };
const left = { side: 'LEFT' as const, startLine: 10 };

describe('localCommentOutdated', () => {
	it('marks a RIGHT-side comment on a deleted file outdated without a loaded diff', () => {
		// The bug this fixes: a comment on a file that was later deleted should badge
		// "outdated" in the sidebar even before the all-removed diff has loaded.
		expect(localCommentOutdated(right, { fileDeleted: true, extent: null })).toBe(true);
	});

	it('stays outdated for a deleted file once its all-removed diff loads (right side gone)', () => {
		expect(localCommentOutdated(right, { fileDeleted: true, extent: { left: 42, right: 0 } })).toBe(
			true
		);
	});

	it('leaves a LEFT-side comment on a deleted file to the extent check', () => {
		// The deletion still renders the old contents, so a comment on a removed line
		// is validly anchored there and must not be flagged.
		expect(localCommentOutdated(left, { fileDeleted: true, extent: { left: 42, right: 0 } })).toBe(
			false
		);
		// Unknown until the contents load.
		expect(localCommentOutdated(left, { fileDeleted: true, extent: null })).toBeUndefined();
	});

	it('reports undefined while a non-deleted file is still loading', () => {
		expect(localCommentOutdated(right, { fileDeleted: false, extent: null })).toBeUndefined();
	});

	it('flags a comment whose anchored line no longer exists in the file', () => {
		expect(localCommentOutdated(right, { fileDeleted: false, extent: { left: 5, right: 5 } })).toBe(
			true
		);
		expect(localCommentOutdated(left, { fileDeleted: false, extent: { left: 5, right: 5 } })).toBe(
			true
		);
	});

	it('keeps a comment whose anchored line still exists', () => {
		expect(
			localCommentOutdated(right, { fileDeleted: false, extent: { left: 20, right: 20 } })
		).toBe(false);
	});
});
