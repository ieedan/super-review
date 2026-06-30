import { describe, expect, it } from 'vitest';
import {
	computeInheritedSeen,
	computeRetainedSeen,
	diffChainCovers,
	parseDiffSig
} from '@super-review/core/seen-inheritance';

// Blob OIDs are just opaque strings here; readable names keep the chains legible.
const MERGEBASE = 'mergebase';
const COMMIT1 = 'commit1';
const COMMIT2 = 'commit2';

const sig = (base: string, dst: string) => `oid:${base}..${dst}`;

describe('parseDiffSig', () => {
	it('splits an oid: signature into base and dst', () => {
		expect(parseDiffSig(sig(MERGEBASE, COMMIT1))).toEqual({ base: MERGEBASE, dst: COMMIT1 });
	});

	it('treats an added file (empty base) as base ""', () => {
		expect(parseDiffSig('oid:..commit1')).toEqual({ base: '', dst: COMMIT1 });
	});

	it('rejects stat-fallback and bare signatures', () => {
		expect(parseDiffSig('M:1:0:t')).toBeNull();
		expect(parseDiffSig(undefined)).toBeNull();
		expect(parseDiffSig('')).toBeNull();
	});
});

describe('computeInheritedSeen', () => {
	it('carries a seen mark across a two-hop chain (the commit-after-review case)', () => {
		// Reviewed the whole branch diff (mergebase..commit1) on the Branch tab,
		// then reviewed a follow-up edit (commit1..commit2) on the unstaged tab,
		// then committed it. The new branch diff is mergebase..commit2, spanned
		// exactly by the two reviewed hops, so it should stay seen.
		const byCtx = {
			'branch:commit1': { 'a.ts': sig(MERGEBASE, COMMIT1) },
			unstaged: { 'a.ts': sig(COMMIT1, COMMIT2) }
		};
		const applied = computeInheritedSeen(
			byCtx,
			'branch:commit2',
			{},
			{ 'a.ts': sig(MERGEBASE, COMMIT2) }
		);
		expect(applied).toEqual(['a.ts']);
	});

	it('carries a seen mark on a direct one-hop match', () => {
		const byCtx = {
			unstaged: { 'a.ts': sig(MERGEBASE, COMMIT2) }
		};
		const applied = computeInheritedSeen(
			byCtx,
			'branch:commit2',
			{},
			{ 'a.ts': sig(MERGEBASE, COMMIT2) }
		);
		expect(applied).toEqual(['a.ts']);
	});

	it('does not inherit when the reviewed hops do not span the current diff', () => {
		// Only the tail hop (commit1..commit2) was reviewed; mergebase..commit1 was
		// never seen, so mergebase can't reach commit2 — there is an unreviewed gap.
		const byCtx = {
			unstaged: { 'a.ts': sig(COMMIT1, COMMIT2) }
		};
		const applied = computeInheritedSeen(
			byCtx,
			'branch:commit2',
			{},
			{ 'a.ts': sig(MERGEBASE, COMMIT2) }
		);
		expect(applied).toEqual([]);
	});

	it('does not re-inherit a diff the user already un-saw (guard record)', () => {
		const byCtx = {
			unstaged: { 'a.ts': sig(MERGEBASE, COMMIT2) }
		};
		const applied = computeInheritedSeen(
			byCtx,
			'branch:commit2',
			{ 'a.ts': sig(MERGEBASE, COMMIT2) },
			{ 'a.ts': sig(MERGEBASE, COMMIT2) }
		);
		expect(applied).toEqual([]);
	});

	it('skips files already seen in the current context', () => {
		const byCtx = {
			'branch:commit2': { 'a.ts': sig(MERGEBASE, COMMIT2) },
			unstaged: { 'a.ts': sig(MERGEBASE, COMMIT2) }
		};
		const applied = computeInheritedSeen(
			byCtx,
			'branch:commit2',
			{},
			{ 'a.ts': sig(MERGEBASE, COMMIT2) }
		);
		expect(applied).toEqual([]);
	});

	it('ignores stat-fallback signatures (no whole-diff proof)', () => {
		const byCtx = {
			unstaged: { 'a.ts': 'M:1:0:t' }
		};
		const applied = computeInheritedSeen(byCtx, 'branch:commit2', {}, { 'a.ts': 'M:1:0:t' });
		expect(applied).toEqual([]);
	});

	it('does not let one file’s edges bleed into another path', () => {
		// b.ts has the spanning chain; a.ts (same OIDs, different path) must not
		// borrow it.
		const byCtx = {
			'branch:commit1': { 'b.ts': sig(MERGEBASE, COMMIT1) },
			unstaged: { 'b.ts': sig(COMMIT1, COMMIT2) }
		};
		const applied = computeInheritedSeen(
			byCtx,
			'branch:commit2',
			{},
			{ 'a.ts': sig(MERGEBASE, COMMIT2) }
		);
		expect(applied).toEqual([]);
	});
});

describe('computeRetainedSeen', () => {
	it('keeps a branch file seen when a chain spans its new post-commit diff', () => {
		// The real bug: a.ts was reviewed on the branch (mergebase..commit1), then a
		// follow-up edit was reviewed unstaged (commit1..commit2), then committed.
		// The branch review key is stable (branch name), so the branch diff just
		// becomes mergebase..commit2 under the SAME key. Its prior reviewed edge
		// (mergebase..commit1) plus the unstaged hop span the new diff exactly, so it
		// must stay seen rather than be unmarked.
		const byCtx = {
			'branch:feature': { 'a.ts': sig(MERGEBASE, COMMIT1) },
			workingTree: { 'a.ts': sig(COMMIT1, COMMIT2) }
		};
		const retained = computeRetainedSeen(byCtx, 'branch:feature', {
			'a.ts': sig(MERGEBASE, COMMIT2)
		});
		expect(retained).toEqual(['a.ts']);
	});

	it('does not keep a file seen when the new diff is not chain-covered', () => {
		// a.ts was seen on the branch (mergebase..commit1), then someone committed an
		// edit (commit3) that was never reviewed anywhere. mergebase can't reach
		// commit3, so it must resurface.
		const byCtx = {
			'branch:feature': { 'a.ts': sig(MERGEBASE, COMMIT1) }
		};
		const retained = computeRetainedSeen(byCtx, 'branch:feature', {
			'a.ts': sig(MERGEBASE, 'commit3')
		});
		expect(retained).toEqual([]);
	});

	it('ignores files that are not currently seen in the context', () => {
		const byCtx = {
			workingTree: { 'a.ts': sig(COMMIT1, COMMIT2) }
		};
		const retained = computeRetainedSeen(byCtx, 'branch:feature', {
			'a.ts': sig(MERGEBASE, COMMIT2)
		});
		expect(retained).toEqual([]);
	});

	it('ignores files whose diff is unchanged', () => {
		const byCtx = {
			'branch:feature': { 'a.ts': sig(MERGEBASE, COMMIT1) }
		};
		const retained = computeRetainedSeen(byCtx, 'branch:feature', {
			'a.ts': sig(MERGEBASE, COMMIT1)
		});
		expect(retained).toEqual([]);
	});
});

describe('diffChainCovers', () => {
	it('does not loop forever on a revert cycle', () => {
		// Reviewed A..B and B..A (an edit and its revert). Asking for A..C must
		// terminate and return false rather than spin on the A<->B cycle.
		const byCtx = {
			x: { 'a.ts': sig('A', 'B') },
			y: { 'a.ts': sig('B', 'A') }
		};
		expect(diffChainCovers(byCtx, 'cur', 'a.ts', { base: 'A', dst: 'C' })).toBe(false);
	});

	it('excludes the current context from the edge set', () => {
		// The only spanning edge lives under the current key, which must be ignored.
		const byCtx = {
			cur: { 'a.ts': sig(MERGEBASE, COMMIT2) }
		};
		expect(diffChainCovers(byCtx, 'cur', 'a.ts', { base: MERGEBASE, dst: COMMIT2 })).toBe(false);
	});
});
