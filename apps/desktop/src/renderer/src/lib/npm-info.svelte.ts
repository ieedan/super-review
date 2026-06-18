// Renderer-side cache for npm package metadata shown in the package.json hover
// cards. The actual fetch happens in the main process (see npm-service); this
// just memoizes the per-package request state so a card can read it reactively
// and repeated hovers of the same package don't re-invoke IPC.

import { SvelteMap } from 'svelte/reactivity';
import type { NpmPackageInfo } from '@shared/types';

export type NpmInfoState =
	| { status: 'loading' }
	| { status: 'loaded'; info: NpmPackageInfo }
	| { status: 'error'; error: string };

// package name → its latest request state. Reactive so a hover card re-renders
// when the fetch resolves.
const cache = new SvelteMap<string, NpmInfoState>();

// Get the current state for a package, kicking off a fetch the first time. The
// returned value is reactive: read it inside a `$derived`/template and it
// updates from 'loading' to 'loaded'/'error' on its own.
export function getNpmInfo(name: string): NpmInfoState {
	const existing = cache.get(name);
	if (existing) return existing;

	const loading: NpmInfoState = { status: 'loading' };
	cache.set(name, loading);

	void window.api.npm
		.getPackageInfo(name)
		.then((result) => {
			cache.set(
				name,
				result.ok
					? { status: 'loaded', info: result.info }
					: { status: 'error', error: result.error }
			);
		})
		.catch((err: unknown) => {
			// IPC itself failed (the handler resolves its own errors, so this is rare).
			cache.set(name, {
				status: 'error',
				error: err instanceof Error ? err.message : 'Failed to load package info.'
			});
		});

	return loading;
}
