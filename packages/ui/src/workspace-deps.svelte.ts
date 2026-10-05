// Renderer-side cache for the monorepo lookups behind `catalog:` and
// `workspace:` dependencies in the package.json hover cards (see
// workspace-service in the main process). Same split as npm-info.svelte.ts: a
// pure reactive read plus a side-effecting request.
//
// Unlike npm metadata these come from the working tree, which can change under
// a review session, so a request refetches once its entry is STALE_MS old. The
// previous value stays visible while it does, so the card never flickers back
// to loading.

import { SvelteMap } from 'svelte/reactivity';
import type { WorkspaceCatalogs, WorkspacePackageInfo } from '@super-review/core/types';

export type WorkspaceLookupState<T> =
	| { status: 'loading' }
	| { status: 'loaded'; value: T }
	| { status: 'error'; error: string };

const STALE_MS = 5_000;

const catalogs = new SvelteMap<string, WorkspaceLookupState<WorkspaceCatalogs>>();
const packages = new SvelteMap<string, WorkspaceLookupState<WorkspacePackageInfo | null>>();
// key → when it was last requested. Plain map: only read by the requesters.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const requestedAt = new Map<string, number>();

function shouldRequest(key: string): boolean {
	const at = requestedAt.get(key);
	if (at != null && Date.now() - at < STALE_MS) return false;
	requestedAt.set(key, Date.now());
	return true;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : 'Failed to read the workspace.';
}

export function getWorkspaceCatalogs(
	repoId: string
): WorkspaceLookupState<WorkspaceCatalogs> | undefined {
	return catalogs.get(repoId);
}

// SIDE-EFFECTING: call from an `$effect`, never a `$derived`/template.
export function requestWorkspaceCatalogs(repoId: string): void {
	if (!shouldRequest(`catalogs:${repoId}`)) return;
	if (!catalogs.has(repoId)) catalogs.set(repoId, { status: 'loading' });
	void window.api.npm
		.getWorkspaceCatalogs(repoId)
		.then((result) => {
			catalogs.set(
				repoId,
				result.ok
					? { status: 'loaded', value: result.catalogs }
					: { status: 'error', error: result.error }
			);
		})
		.catch((err: unknown) => catalogs.set(repoId, { status: 'error', error: errorMessage(err) }));
}

export function getWorkspacePackage(
	repoId: string,
	name: string
): WorkspaceLookupState<WorkspacePackageInfo | null> | undefined {
	return packages.get(`${repoId}:${name}`);
}

// SIDE-EFFECTING: call from an `$effect`, never a `$derived`/template.
export function requestWorkspacePackage(repoId: string, name: string): void {
	const key = `${repoId}:${name}`;
	if (!shouldRequest(`package:${key}`)) return;
	if (!packages.has(key)) packages.set(key, { status: 'loading' });
	void window.api.npm
		.getWorkspacePackage(repoId, name)
		.then((result) => {
			packages.set(
				key,
				result.ok
					? { status: 'loaded', value: result.info }
					: { status: 'error', error: result.error }
			);
		})
		.catch((err: unknown) => packages.set(key, { status: 'error', error: errorMessage(err) }));
}
