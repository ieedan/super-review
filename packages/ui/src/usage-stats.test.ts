import { describe, expect, it } from 'vitest';
import {
	addToDay,
	aggregateStats,
	dayKey,
	emptyStats,
	emptyStoredStats,
	metricTotal,
	projectStats,
	STAT_METRICS,
	type RepoUsageStats
} from '@super-review/core/usage-stats';

describe('dayKey', () => {
	it('formats a local date as zero-padded YYYY-MM-DD', () => {
		expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
		expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
	});
});

describe('emptyStats', () => {
	it('has an empty bucket map for every metric and no first-used time', () => {
		const s = emptyStats();
		expect(s.firstUsedAt).toBeNull();
		for (const m of STAT_METRICS) expect(s.daily[m]).toEqual({});
	});
});

describe('addToDay / metricTotal', () => {
	it('accumulates per-day and sums to the all-time total', () => {
		const daily = {};
		addToDay(daily, '2026-01-01', 2);
		addToDay(daily, '2026-01-01', 3);
		addToDay(daily, '2026-01-02', 1);
		expect(daily).toEqual({ '2026-01-01': 5, '2026-01-02': 1 });
		expect(metricTotal(daily)).toBe(6);
	});

	it('totals an empty map to zero', () => {
		expect(metricTotal({})).toBe(0);
	});
});

describe('projectStats', () => {
	it('exposes the daily buckets and drops the dedup sets', () => {
		const stored = emptyStoredStats();
		stored.firstUsedAt = 1000;
		stored.reviewedSigs = ['a', 'b'];
		addToDay(stored.daily.filesReviewed, '2026-01-01', 2);
		const projected = projectStats(stored);
		expect(projected).toEqual({ daily: stored.daily, firstUsedAt: 1000 });
		expect('reviewedSigs' in projected).toBe(false);
	});
});

describe('aggregateStats', () => {
	function withDay(
		metric: keyof RepoUsageStats['daily'],
		key: string,
		n: number,
		firstUsedAt: number
	) {
		const s = emptyStats();
		s.firstUsedAt = firstUsedAt;
		addToDay(s.daily[metric], key, n);
		return s;
	}

	it('merges per-day buckets across repos by summing each day', () => {
		const a = withDay('commitsAuthored', '2026-01-01', 3, 2000);
		const b = withDay('commitsAuthored', '2026-01-01', 4, 1000);
		addToDay(b.daily.commitsAuthored, '2026-01-02', 1);
		const total = aggregateStats([a, b]);
		expect(total.daily.commitsAuthored).toEqual({ '2026-01-01': 7, '2026-01-02': 1 });
	});

	it('takes the earliest non-null firstUsedAt', () => {
		const a = withDay('prsMerged', '2026-01-01', 1, 2000);
		const b = withDay('prsMerged', '2026-01-01', 1, 1000);
		expect(aggregateStats([a, b]).firstUsedAt).toBe(1000);
	});

	it('ignores null timestamps and handles the empty case', () => {
		const never = emptyStats();
		const used = withDay('prsMerged', '2026-01-01', 1, 2000);
		expect(aggregateStats([never, used]).firstUsedAt).toBe(2000);
		expect(aggregateStats([]).firstUsedAt).toBeNull();
		expect(aggregateStats([])).toEqual(emptyStats());
	});
});
