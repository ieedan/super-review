<script lang="ts">
	// Test-only harness: mounts the REAL DiffView (and therefore the real find
	// controller, IntersectionObserver wiring, Pierre shadow-DOM render, and
	// FindBar) against in-memory fixtures, with a mocked `window.api`. Browser
	// tests render this and drive find through its public functions, asserting on
	// CSS Custom Highlights. This is the only place the reactivity↔DOM glue (where
	// every recurring find bug lived) is exercised end to end.
	import { onMount, untrack } from 'svelte';
	import DiffView from '@super-review/ui/components/DiffView.svelte';
	import { app, setCachedDiff } from '@super-review/ui/store.svelte';
	import { initDiffWorkerPool } from '@super-review/ui/diff-worker-pool';
	import type { DiffData } from '@super-review/core/types';

	type Props = { fixtures: DiffData[]; collapsed?: string[] };
	let { fixtures: fixturesProp, collapsed: collapsedProp = [] }: Props = $props();
	// One-shot setup: tests render once and never change props, so read the
	// initial values (untrack keeps the compiler from warning about reactivity).
	const fixtures = untrack(() => fixturesProp);
	const collapsed = untrack(() => collapsedProp);

	const REPO = { id: 'repo1', path: '/tmp/demo', name: 'demo' };
	const CTX = { kind: 'workingTree' as const };

	// Install the api mock synchronously — the parent script runs before DiffView's
	// children mount, so it's in place before any section's fetch effect fires.
	const asyncNoop = (): Promise<undefined> => Promise.resolve(undefined);
	const byPath = new Map(fixtures.map((f) => [f.file.path, f]));
	const branch = (overrides: Record<string, unknown> = {}): unknown =>
		new Proxy(asyncNoop as object, {
			get(_t, prop) {
				if (typeof prop === 'string' && prop in overrides) return overrides[prop];
				return branch();
			},
			apply: () => Promise.resolve(undefined)
		});
	(window as unknown as { api: unknown }).api = branch({
		platform: 'darwin',
		git: branch({
			getDiff: async (_repo: string, path: string) => byPath.get(path) ?? null
		}),
		state: branch({
			getPrefs: async () => ({}),
			setPrefs: asyncNoop,
			setFileCollapsed: asyncNoop,
			setFileSeen: asyncNoop,
			getCollapsedFiles: async () => [],
			getSeenFiles: async () => [],
			getSeenSignatures: async () => ({})
		})
	});

	// Seed the store + diff cache before DiffView reads them.
	app.activeRepo = REPO as never;
	app.diffContext = CTX as never;
	app.contextTab = 'unstaged';
	app.theme = 'light';
	app.viewMode = 'unified';
	app.diffLayout = 'scroll';
	app.changedFiles = fixtures.map((f) => f.file) as never;
	app.collapsedFiles.clear();
	for (const p of collapsed) app.collapsedFiles.add(p);
	for (const f of fixtures) setCachedDiff(REPO.id, CTX as never, f.file.path, f);

	onMount(() => {
		initDiffWorkerPool();
	});
</script>

<!-- A real, sized scroll viewport so the IntersectionObserver + sticky layout
     behave exactly as in the app. -->
<div style="height: 600px; width: 900px; display: flex; flex-direction: column;">
	<DiffView />
</div>
