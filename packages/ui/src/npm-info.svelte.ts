// Renderer-side cache for npm package metadata shown in the package.json hover
// cards. The actual fetch happens in the main process (see npm-service); this
// just memoizes the per-package request state so a card can read it reactively
// and repeated hovers of the same package don't re-invoke IPC.

import { SvelteMap } from 'svelte/reactivity';
import type { NpmPackageInfo } from '@super-review/core/types';

export type NpmInfoState =
	| { status: 'loading' }
	| { status: 'loaded'; info: NpmPackageInfo }
	| { status: 'error'; error: string };

// package name → its latest request state. Reactive so a hover card re-renders
// when the fetch resolves.
const cache = new SvelteMap<string, NpmInfoState>();

// Reactive read of a package's current request state. Pure, safe to call
// inside a `$derived`/template; re-runs when the fetch resolves. Returns
// undefined until a fetch has been kicked off via `requestNpmInfo` (treat that
// as 'loading'). Kept separate from the trigger below because populating the
// cache mutates reactive state, which Svelte forbids during derivation.
export function getNpmInfo(name: string): NpmInfoState | undefined {
	return cache.get(name);
}

// Kick off a fetch for `name` the first time it's requested. SIDE-EFFECTING (it
// writes the reactive cache), so call it from an `$effect`, never from inside a
// `$derived` or a template expression, or you get `state_unsafe_mutation`.
export function requestNpmInfo(name: string): void {
	if (cache.has(name)) return;
	cache.set(name, { status: 'loading' });

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
}
