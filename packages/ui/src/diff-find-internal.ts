// Non-reactive, module-private registries backing the find controller. They
// live in a plain `.ts` module (not `.svelte.ts`) on purpose: this is imperative
// bookkeeping over the rendered diff DOM, not reactive UI state, so they stay
// ordinary Maps. The reactive `find` state lives in diff-find.svelte.ts.

// The per-file match index (counts + flat-index mapping) now lives in the
// incremental FindIndex (diff-find-index.ts); this module only holds the
// DOM-bound registries below.

export interface RegisteredSection {
	sectionEl: HTMLElement;
	// Set by DiffFileSection. True iff the section is inside the IntersectionObserver
	// margin AND its host has been populated with Pierre's DOM.
	inView: boolean;
	// Bumped every time the section's Pierre render replaces / clears the DOM.
	// We use this to invalidate cached Range objects (which would dangle if
	// their underlying text nodes were removed).
	renderEpoch: number;
	// Find-only fast lane: run Pierre's render now, bypassing the global
	// FRAME_BUDGET_MS scheduler. Returns true if the section has rendered DOM
	// by the time it returns (already rendered or just rendered in-place).
	// Returns false if data hasn't been hydrated yet — caller should fall back
	// to the async wait-on-render path.
	renderIfNeeded?: () => boolean;
}
export const sections = new Map<string, RegisteredSection>();

// Per-file Range cache used by the "all matches" yellow highlight. Keyed by
// file path; tagged with the renderEpoch AND the query signature it was built
// against, so a query change (which doesn't bump the epoch) still forces a
// rebuild instead of leaving stale ranges from the previous search.
export interface BuiltRanges {
	epoch: number;
	querySig: string;
	ranges: Range[];
}
export const builtRanges = new Map<string, BuiltRanges>();

// Resolvers waiting for a specific file to finish rendering. Navigation
// parks here when the target file's DOM isn't built yet; `notifySectionState`
// flushes them when the renderEpoch changes.
export const renderWaiters = new Map<string, Array<() => void>>();
