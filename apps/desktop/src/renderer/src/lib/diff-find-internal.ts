// Non-reactive, module-private registries backing the find controller. They
// live in a plain `.ts` module (not `.svelte.ts`) on purpose: this is imperative
// bookkeeping over the rendered diff DOM, not reactive UI state, so they stay
// ordinary Maps. The reactive `find` state lives in diff-find.svelte.ts.

// One entry per file path → list of match positions inside the searchable
// text we derive from `cached.patch`. The same algorithm is used to walk
// the file's DOM when we need to paint, so the Nth match in DOM aligns with
// the Nth match here.
export interface PatchMatch {
	start: number;
	end: number;
}
export const matchesByFile = new Map<string, PatchMatch[]>();

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
// file path; tagged with the renderEpoch it was built against.
export interface BuiltRanges {
	epoch: number;
	ranges: Range[];
}
export const builtRanges = new Map<string, BuiltRanges>();

// Resolvers waiting for a specific file to finish rendering. Navigation
// parks here when the target file's DOM isn't built yet; `notifySectionState`
// flushes them when the renderEpoch changes.
export const renderWaiters = new Map<string, Array<() => void>>();
