import { describe, expect, it } from 'vitest';
import { equalSplit, isBalanced, percentSplit, sharesSplit } from '../src/lib/split.js';
import { sum } from '../src/lib/money.js';

describe('equalSplit', () => {
	it('divides evenly when the total divides evenly', () => {
		const split = equalSplit(3000, ['a', 'b', 'c']);
		expect(split.shares).toEqual({ a: 1000, b: 1000, c: 1000 });
	});

	it('hands the leftover cents out one at a time', () => {
		const split = equalSplit(1000, ['a', 'b', 'c']);
		expect(split.shares).toEqual({ a: 334, b: 333, c: 333 });
	});

	it('never loses a cent, whatever the group size', () => {
		for (let size = 1; size <= 12; size++) {
			const memberIds = Array.from({ length: size }, (_, i) => `m${i}`);
			const split = equalSplit(9999, memberIds);
			expect(sum(Object.values(split.shares))).toBe(9999);
		}
	});

	it('is empty for a group with no members', () => {
		expect(equalSplit(1000, []).shares).toEqual({});
	});
});

describe('sharesSplit', () => {
	it('divides by weight', () => {
		const split = sharesSplit(3000, { a: 2, b: 1 });
		expect(split.shares).toEqual({ a: 2000, b: 1000 });
	});

	it('treats weights as relative', () => {
		const scaled = sharesSplit(3000, { a: 200, b: 100 });
		expect(scaled.shares).toEqual({ a: 2000, b: 1000 });
	});
});

describe('percentSplit', () => {
	it('reads weights as percentages', () => {
		const split = percentSplit(4000, { a: 75, b: 25 });
		expect(split.shares).toEqual({ a: 3000, b: 1000 });
	});
});

describe('isBalanced', () => {
	it('accepts a split whose shares sum to the total', () => {
		expect(isBalanced(equalSplit(1000, ['a', 'b', 'c']), 1000)).toBe(true);
	});

	it('rejects a split that dropped a cent', () => {
		const broken = { kind: 'equal' as const, shares: { a: 333, b: 333, c: 333 } };
		expect(isBalanced(broken, 1000)).toBe(false);
	});
});
