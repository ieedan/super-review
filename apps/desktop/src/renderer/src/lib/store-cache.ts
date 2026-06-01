import type { ChangedFile, DiffData, PRSource } from '@shared/types';

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

// Stale-while-revalidate caches keyed by repo + diff context. Switching tabs
// hydrates from these immediately so the file list and diffs feel snappy
// while a background refresh fetches the latest.
export interface FilesCacheEntry {
	changedFiles: ChangedFile[];
	seenFiles: Set<string>;
	collapsedFiles: Set<string>;
	selectedFile: string | null;
}
export const filesCache = new Map<string, FilesCacheEntry>();
export const diffCache = new Map<string, DiffData>();

// Push-access answers are stable for a session, so cache per repo+PR to avoid
// re-hitting the API on every branch-PR refresh.
export const prPushAccess = new Map<string, boolean>();

// Whether the account can push to each repo's `origin`, cached per repo so the
// fork banner/detection only hits the GitHub API once per repo per session.
export const repoPushAccessChecked = new Map<string, boolean>();
