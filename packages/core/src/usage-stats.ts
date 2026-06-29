// Local, per-repo usage statistics. Everything here is pure and browser-safe so
// the renderer can import the type and the aggregation helper directly, while the
// Electron main process persists the stored shape (see apps/desktop store.ts).
//
// Nothing in this module touches the network: usage stats are computed and stored
// entirely on the user's machine.

// The public, display-ready shape. `filesReviewed` and `sessionsReviewed` are
// derived from the deduped sets in StoredRepoStats so they can never drift from
// the data backing them.
export interface RepoUsageStats {
	// Distinct file contents the user has marked seen (deduped by content hash, so
	// re-reviewing the same content does not recount, but reviewing genuinely
	// changed content does).
	filesReviewed: number;
	// Lines of code (additions + deletions) across those distinct file contents.
	locReviewed: number;
	prsMerged: number;
	branchesCreated: number;
	commitsAuthored: number;
	// Distinct guided-tour sessions opened.
	sessionsReviewed: number;
	commentsWritten: number;
	// When the repo's stats first started accumulating (ms epoch), or null when the
	// repo has no recorded activity yet.
	firstUsedAt: number | null;
}

// The persisted shape. Counts that need de-duplication keep the underlying sets
// (as arrays, for JSON storage) rather than a bare number, so we can tell whether
// a sig/session id is new before counting it.
export interface StoredRepoStats {
	locReviewed: number;
	prsMerged: number;
	branchesCreated: number;
	commitsAuthored: number;
	commentsWritten: number;
	// Content signatures of every distinct file content marked seen in this repo.
	reviewedSigs: string[];
	// Ids of every distinct session opened in this repo.
	reviewedSessionIds: string[];
	firstUsedAt: number | null;
}

export function emptyStoredStats(): StoredRepoStats {
	return {
		locReviewed: 0,
		prsMerged: 0,
		branchesCreated: 0,
		commitsAuthored: 0,
		commentsWritten: 0,
		reviewedSigs: [],
		reviewedSessionIds: [],
		firstUsedAt: null
	};
}

export function emptyStats(): RepoUsageStats {
	return {
		filesReviewed: 0,
		locReviewed: 0,
		prsMerged: 0,
		branchesCreated: 0,
		commitsAuthored: 0,
		sessionsReviewed: 0,
		commentsWritten: 0,
		firstUsedAt: null
	};
}

// Project the persisted shape to the display shape, deriving the deduped counts
// from their backing sets.
export function projectStats(s: StoredRepoStats): RepoUsageStats {
	return {
		filesReviewed: s.reviewedSigs.length,
		locReviewed: s.locReviewed,
		prsMerged: s.prsMerged,
		branchesCreated: s.branchesCreated,
		commitsAuthored: s.commitsAuthored,
		sessionsReviewed: s.reviewedSessionIds.length,
		commentsWritten: s.commentsWritten,
		firstUsedAt: s.firstUsedAt
	};
}

// Sum the counters across repos for an "all repos" roll-up. `firstUsedAt` becomes
// the earliest non-null timestamp (when the user first used any of them).
export function aggregateStats(all: RepoUsageStats[]): RepoUsageStats {
	const total = emptyStats();
	for (const s of all) {
		total.filesReviewed += s.filesReviewed;
		total.locReviewed += s.locReviewed;
		total.prsMerged += s.prsMerged;
		total.branchesCreated += s.branchesCreated;
		total.commitsAuthored += s.commitsAuthored;
		total.sessionsReviewed += s.sessionsReviewed;
		total.commentsWritten += s.commentsWritten;
		if (s.firstUsedAt !== null) {
			total.firstUsedAt =
				total.firstUsedAt === null ? s.firstUsedAt : Math.min(total.firstUsedAt, s.firstUsedAt);
		}
	}
	return total;
}
