// Renderer-side cache for GitHub release notes shown in the package.json hover
// card's "What's new" disclosure. The fetch happens in the main process (see
// github-service); this memoizes the per-package request state so a card can
// read it reactively and repeated hovers don't re-invoke IPC.
//
// Same split as npm-info.svelte.ts: a pure reactive read (`getReleaseNotes`,
// safe inside a `$derived`/template) plus a side-effecting trigger
// (`requestReleaseNotes`, must run from an `$effect`) - writing the reactive
// cache during derivation throws `state_unsafe_mutation`.

import { SvelteMap } from 'svelte/reactivity';
import type { ReleaseNotes } from '@super-review/core/types';
import { getNpmProvider } from './npm-provider';

export type ReleaseNotesState =
	| { status: 'loading' }
	| { status: 'loaded'; release: ReleaseNotes | null }
	| { status: 'error'; error: string };

export type ReleaseNotesRangeState =
	| { status: 'loading' }
	| { status: 'loaded'; releases: ReleaseNotes[]; truncated: boolean }
	| { status: 'error'; error: string };

// `${packageName}@${version}` -> request state, keyed by package (not repo) so
// monorepo packages sharing a repo don't collide. Reactive so a card re-renders
// when the fetch resolves.
const cache = new SvelteMap<string, ReleaseNotesState>();

function keyFor(packageName: string, version: string): string {
	return `${packageName}@${version}`;
}

// Reactive read of the current state for a package version. Pure - safe in a
// `$derived`/template. Returns undefined until a fetch has been kicked off via
// `requestReleaseNotes` (treat that as 'loading').
export function getReleaseNotes(
	packageName: string,
	version: string
): ReleaseNotesState | undefined {
	return cache.get(keyFor(packageName, version));
}

// Kick off a fetch the first time a package version is requested. SIDE-EFFECTING
// (writes the reactive cache), so call it from an `$effect`, never a `$derived`.
export function requestReleaseNotes(
	repositoryUrl: string,
	packageName: string,
	version: string
): void {
	const key = keyFor(packageName, version);
	if (cache.has(key)) return;
	cache.set(key, { status: 'loading' });

	void getNpmProvider()
		.getReleaseNotes(repositoryUrl, packageName, version)
		.then((result) => {
			cache.set(
				key,
				result.ok
					? { status: 'loaded', release: result.release }
					: { status: 'error', error: result.error }
			);
		})
		.catch((err: unknown) => {
			cache.set(key, {
				status: 'error',
				error: err instanceof Error ? err.message : 'Failed to load release notes.'
			});
		});
}

// ─── Range (a dependency whose version changed in the diff) ──────────────────
// `${packageName}:${from}..${to}` -> state. Direction-insensitive on the server
// (it normalizes to low..high), but we key by the exact pair the card asks for.
const rangeCache = new SvelteMap<string, ReleaseNotesRangeState>();

function rangeKeyFor(packageName: string, from: string, to: string): string {
	return `${packageName}:${from}..${to}`;
}

// Reactive read of a range request. Pure; safe in a `$derived`/template.
export function getReleaseNotesRange(
	packageName: string,
	from: string,
	to: string
): ReleaseNotesRangeState | undefined {
	return rangeCache.get(rangeKeyFor(packageName, from, to));
}

// Kick off a range fetch the first time it's requested. SIDE-EFFECTING; call it
// from an `$effect`, never a `$derived`.
export function requestReleaseNotesRange(
	repositoryUrl: string,
	packageName: string,
	from: string,
	to: string
): void {
	const key = rangeKeyFor(packageName, from, to);
	if (rangeCache.has(key)) return;
	rangeCache.set(key, { status: 'loading' });

	void getNpmProvider()
		.getReleaseNotesRange(repositoryUrl, packageName, from, to)
		.then((result) => {
			rangeCache.set(
				key,
				result.ok
					? { status: 'loaded', releases: result.releases, truncated: result.truncated }
					: { status: 'error', error: result.error }
			);
		})
		.catch((err: unknown) => {
			rangeCache.set(key, {
				status: 'error',
				error: err instanceof Error ? err.message : 'Failed to load release notes.'
			});
		});
}
