import { describe, expect, it } from 'vitest';
import {
	aggregateStats,
	emptyStats,
	emptyStoredStats,
	projectStats,
	type RepoUsageStats
} from '@super-review/core/usage-stats';

describe('emptyStats', () => {
	it('is all zeros with no first-used timestamp', () => {
		expect(emptyStats()).toEqual({
			filesReviewed: 0,
			locReviewed: 0,
			prsMerged: 0,
			branchesCreated: 0,
			commitsAuthored: 0,
			sessionsReviewed: 0,
			commentsWritten: 0,
			firstUsedAt: null
		});
	});
});

describe('projectStats', () => {
	it('derives deduped counts from the backing sets', () => {
		const stored = {
			...emptyStoredStats(),
			locReviewed: 120,
			prsMerged: 2,
			reviewedSigs: ['a', 'b', 'c'],
			reviewedSessionIds: ['s1', 's2'],
			firstUsedAt: 1000
		};
		const projected = projectStats(stored);
		expect(projected.filesReviewed).toBe(3);
		expect(projected.sessionsReviewed).toBe(2);
		expect(projected.locReviewed).toBe(120);
		expect(projected.prsMerged).toBe(2);
		expect(projected.firstUsedAt).toBe(1000);
	});
});

describe('aggregateStats', () => {
	const a: RepoUsageStats = {
		filesReviewed: 3,
		locReviewed: 100,
		prsMerged: 1,
		branchesCreated: 2,
		commitsAuthored: 4,
		sessionsReviewed: 1,
		commentsWritten: 5,
		firstUsedAt: 2000
	};
	const b: RepoUsageStats = {
		filesReviewed: 7,
		locReviewed: 50,
		prsMerged: 3,
		branchesCreated: 0,
		commitsAuthored: 1,
		sessionsReviewed: 2,
		commentsWritten: 0,
		firstUsedAt: 1000
	};

	it('sums every counter across repos', () => {
		const total = aggregateStats([a, b]);
		expect(total.filesReviewed).toBe(10);
		expect(total.locReviewed).toBe(150);
		expect(total.prsMerged).toBe(4);
		expect(total.branchesCreated).toBe(2);
		expect(total.commitsAuthored).toBe(5);
		expect(total.sessionsReviewed).toBe(3);
		expect(total.commentsWritten).toBe(5);
	});

	it('takes the earliest non-null firstUsedAt', () => {
		expect(aggregateStats([a, b]).firstUsedAt).toBe(1000);
	});

	it('ignores null timestamps when computing the earliest', () => {
		const never = { ...emptyStats() };
		expect(aggregateStats([never, a]).firstUsedAt).toBe(2000);
		expect(aggregateStats([never]).firstUsedAt).toBeNull();
	});

	it('returns an all-zero roll-up for no repos', () => {
		expect(aggregateStats([])).toEqual(emptyStats());
	});
});
