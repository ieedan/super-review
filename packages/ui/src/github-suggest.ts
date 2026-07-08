// Data source for the composer's @mention / #reference typeahead
// (GithubSuggest.svelte). Both fetchers read the active repo from the store and
// go through the `window.api.github` bridge to the main process, which resolves
// the repo's GitHub host (upstream for a fork, else its own remote).
//
// Results are cached per repo id with a short TTL so reopening the popup — or
// typing another character — doesn't refetch on every keystroke. The component
// filters the cached list client-side; only a bare-number issue query (which
// may need an older issue resolved by number) bypasses the cache.
import { app } from './store.svelte';
import type { IssueReference, MentionableUser } from '@super-review/core/types';

// Assignable users barely change during a review; issues/PRs churn faster, so
// its recent list is kept fresher.
const USER_TTL = 5 * 60_000;
const ISSUE_TTL = 30_000;

interface Entry<T> {
	at: number;
	value: Promise<T>;
}

const userCache = new Map<string, Entry<MentionableUser[]>>();
const issueCache = new Map<string, Entry<IssueReference[]>>();

/** Assignable users for the active repo, cached per repo id. `[]` off GitHub. */
export function fetchMentionableUsers(): Promise<MentionableUser[]> {
	const repo = app.activeRepo;
	const fn = window.api?.github?.listMentionableUsers;
	if (!repo?.githubOwner || typeof fn !== 'function') return Promise.resolve([]);
	const id = repo.id;
	const hit = userCache.get(id);
	const now = Date.now();
	if (hit && now - hit.at < USER_TTL) return hit.value;
	// `?? []` also absorbs the Storybook/docs api stub, which resolves to undefined.
	const value = fn(id)
		.then((r) => r ?? [])
		.catch(() => []);
	userCache.set(id, { at: now, value });
	return value;
}

/**
 * Recent issues + PRs for the active repo, cached per repo id. When `query` is a
 * bare number the cache is bypassed so the main process can resolve that exact
 * issue/PR (even an older one not in the recent page) and prepend it.
 */
export function fetchIssueReferences(query?: string): Promise<IssueReference[]> {
	const repo = app.activeRepo;
	const fn = window.api?.github?.listIssueReferences;
	if (!repo?.githubOwner || typeof fn !== 'function') return Promise.resolve([]);
	const id = repo.id;
	const isNumber = !!query && /^\d+$/.test(query.trim());
	// `?? []` also absorbs the Storybook/docs api stub, which resolves to undefined.
	if (isNumber)
		return fn(id, query)
			.then((r) => r ?? [])
			.catch(() => []);
	const hit = issueCache.get(id);
	const now = Date.now();
	if (hit && now - hit.at < ISSUE_TTL) return hit.value;
	const value = fn(id)
		.then((r) => r ?? [])
		.catch(() => []);
	issueCache.set(id, { at: now, value });
	return value;
}
