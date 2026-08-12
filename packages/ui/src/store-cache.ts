import type { ChangedFile, ContextTab, DiffData, PRSource } from '@super-review/core/types';

// Module-private, non-reactive session caches and registries for the store.
// These deliberately live in a plain `.ts` module (not `.svelte.ts`): they're
// caches keyed off ids/paths, not reactive UI state, so they stay ordinary
// Map/Set rather than the svelte/reactivity wrappers.

// Repos whose upstream we've already resolved this session, so we only hit the
// GitHub API once per repo to detect a fork's parent.
export const upstreamChecked = new Set<string>();

// A user's explicit PR-source choice per repo, remembered for the session so it
// survives reopening the picker. Absent → use the repo's default source.
export const prsSourceByRepo = new Map<string, PRSource>();

// The last file-list tab a repo was on, remembered for the session so switching
// away and back reopens the tab you left rather than resetting to Unstaged.
// Absent → fall back to the persisted launch tab / Unstaged.
export const contextTabByRepo = new Map<string, ContextTab>();

// The work-area layout a repo was left with, remembered for the session so
// switching away and back restores how each repo looked: whether the
// comments/conversation panel was open, which tab it showed, whether it was
// fullscreen, and whether the left file-list sidebar was collapsed. These are
// otherwise globally persisted prefs, so without this they leak across repos —
// e.g. a fullscreen conversation in one repo stays fullscreen after switching to
// another that has nothing to be fullscreen about. Absent → a clean default.
export interface RepoViewLayout {
	commentsSidebarOpen: boolean;
	commentsSidebarTab: 'tasks' | 'comments' | 'conversation';
	conversationFullscreen: boolean;
	sidebarCollapsed: boolean;
}
export const viewLayoutByRepo = new Map<string, RepoViewLayout>();

// A diff-view scroll position, stored as the file at the top of the viewport
// plus how far its section's top sits from the container top (`offset`, ≤ 0
// once scrolled past it). Anchoring to a file rather than a raw `scrollTop`
// survives the content above it changing height — a refresh adding/removing
// files, or async diffs rendering in — which is exactly when a raw pixel
// position would drift.
export interface ScrollAnchor {
	path: string;
	offset: number;
}

// Stale-while-revalidate caches keyed by repo + diff context. Switching tabs
// hydrates from these immediately so the file list and diffs feel snappy
// while a background refresh fetches the latest.
export interface FilesCacheEntry {
	changedFiles: ChangedFile[];
	seenFiles: Set<string>;
	collapsedFiles: Set<string>;
	selectedFile: string | null;
	// Where the reviewer was scrolled to in this context, so returning to the tab
	// (or a refresh) restores their place instead of jumping to the top.
	scrollAnchor?: ScrollAnchor | null;
}
export const filesCache = new Map<string, FilesCacheEntry>();
export const diffCache = new Map<string, DiffData>();

// Diff-cache keys with a prefetch currently in flight. The prefetch is driven by
// the reviewer's position, which the scroll handler updates every frame, so
// without this a burst of scrolling would fire the same `getDiff` repeatedly
// before the first one lands. Entries are dropped once the fetch settles — from
// then on `diffCache` itself is the dedupe.
export const diffPrefetchInFlight = new Set<string>();

// Push-access answers are stable for a session, so cache per repo+PR to avoid
// re-hitting the API on every branch-PR refresh.
export const prPushAccess = new Map<string, boolean>();

// Whether the account can push to each repo's `origin`, cached per repo so the
// fork banner/detection only hits the GitHub API once per repo per session.
export const repoPushAccessChecked = new Map<string, boolean>();
