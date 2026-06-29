// Local, per-repo usage statistics. Everything here is pure and browser-safe so
// the renderer can import the types and helpers directly, while the Electron main
// process persists the stored shape (see apps/desktop store.ts).
//
// Nothing in this module touches the network: usage stats are computed and stored
// entirely on the user's machine.
//
// Stats are kept as per-day buckets per metric (a `dayKey -> count` map) rather
// than running totals, so the UI can render a contribution-style heatmap and
// time-windowed KPIs ("today", "this month") on top of the same data.

export type StatMetric =
	| 'filesReviewed'
	| 'locReviewed'
	| 'prsMerged'
	| 'branchesCreated'
	| 'commitsAuthored'
	| 'sessionsReviewed'
	| 'commentsWritten';

// All metrics, in canonical (display) order. Iterate this when building empty
// shapes or merging, so adding a metric is a one-line change.
export const STAT_METRICS: readonly StatMetric[] = [
	'filesReviewed',
	'locReviewed',
	'prsMerged',
	'branchesCreated',
	'commitsAuthored',
	'sessionsReviewed',
	'commentsWritten'
];

// A single metric's activity, keyed by local day (`dayKey`) -> count for that day.
// Days with no activity are simply absent.
export type DailyCounts = Record<string, number>;

// The public, display-ready shape: one daily-bucket map per metric, plus the
// first time the repo recorded any activity.
export interface RepoUsageStats {
	daily: Record<StatMetric, DailyCounts>;
	firstUsedAt: number | null;
}

// The persisted shape. Adds the de-duplication sets used to decide whether a
// file (by content signature) or session (by id) is new before it is counted;
// these never reach the renderer.
export interface StoredRepoStats extends RepoUsageStats {
	reviewedSigs: string[];
	reviewedSessionIds: string[];
}

// A stable, sortable local-day key: `YYYY-MM-DD` in the machine's own timezone
// (the same wall-clock day the user sees). The single source of truth for the
// bucket key format, shared by the recorder (main) and the readers (renderer).
export function dayKey(date: Date): string {
	const y = date.getFullYear();
	const m = `${date.getMonth() + 1}`.padStart(2, '0');
	const d = `${date.getDate()}`.padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function emptyDaily(): Record<StatMetric, DailyCounts> {
	const daily = {} as Record<StatMetric, DailyCounts>;
	for (const m of STAT_METRICS) daily[m] = {};
	return daily;
}

export function emptyStats(): RepoUsageStats {
	return { daily: emptyDaily(), firstUsedAt: null };
}

export function emptyStoredStats(): StoredRepoStats {
	return { ...emptyStats(), reviewedSigs: [], reviewedSessionIds: [] };
}

// Add `n` to a metric's bucket for `key`, creating the bucket as needed.
export function addToDay(daily: DailyCounts, key: string, n: number): void {
	daily[key] = (daily[key] ?? 0) + n;
}

// Sum every day's count for one metric (its all-time total).
export function metricTotal(daily: DailyCounts): number {
	let total = 0;
	for (const v of Object.values(daily)) total += v;
	return total;
}

// Project the persisted shape to the display shape (drops the dedup sets).
export function projectStats(s: StoredRepoStats): RepoUsageStats {
	return { daily: s.daily, firstUsedAt: s.firstUsedAt };
}

// Merge two daily-bucket maps by summing each day.
function mergeDaily(into: DailyCounts, from: DailyCounts): void {
	for (const [key, v] of Object.entries(from)) addToDay(into, key, v);
}

// Sum the per-day buckets across repos for an "all repos" roll-up. `firstUsedAt`
// becomes the earliest non-null timestamp (when the user first used any of them).
export function aggregateStats(all: RepoUsageStats[]): RepoUsageStats {
	const total = emptyStats();
	for (const s of all) {
		for (const m of STAT_METRICS) mergeDaily(total.daily[m], s.daily[m] ?? {});
		if (s.firstUsedAt !== null) {
			total.firstUsedAt =
				total.firstUsedAt === null ? s.firstUsedAt : Math.min(total.firstUsedAt, s.firstUsedAt);
		}
	}
	return total;
}
