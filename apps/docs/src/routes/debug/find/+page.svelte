<script lang="ts">
	import './debug.css';
	import { onMount } from 'svelte';
	import DiffView from '@super-review/ui/components/DiffView.svelte';
	import { app, setCachedDiff, getCachedDiff } from '@super-review/ui/store.svelte';
	import {
		find,
		openFind,
		closeFind,
		setQuery,
		nextMatch,
		prevMatch
	} from '@super-review/ui/diff-find.svelte';
	import { initDiffWorkerPool } from '@super-review/ui/diff-worker-pool';
	import { sections } from '@super-review/ui/diff-find-internal';
	import { _findIndex } from '@super-review/ui/diff-find.svelte';
	import fixtureData from '$lib/find-fixtures.json';

	type Fixture = {
		file: {
			path: string;
			status: string;
			additions: number;
			deletions: number;
			isBinary: boolean;
		};
		patch: string;
		oldContents: string;
		newContents: string;
		truncated: boolean;
	};
	const committed = fixtureData as unknown as {
		token: string;
		totalMatches: number;
		fixtures: Fixture[];
	};

	// Synthesize N added-file fixtures entirely client-side so the harness can be
	// stressed to any scale (`/debug/find?files=2000&lines=160`) without committing
	// a multi-MB JSON. Added files (old = '') let the patch be a simple all-`+`
	// hunk that aligns with Pierre's all-additions render. The committed JSON
	// (realistic git-diff'd modified files) is the default when no `?files=` is set.
	function synthFixtures(count: number, linesPer: number): typeof committed {
		const fixtures: Fixture[] = [];
		for (let k = 0; k < count; k++) {
			const lines: string[] = [
				`import { widgetFactory, createWidget } from '$lib/widgets/core';`,
				`import type { WidgetProps, WidgetState } from '$lib/widgets/types';`,
				``,
				`export function setupWidget${k}(props: WidgetProps) {`,
				`	const widget = widgetFactory(props);`,
				`	let state: WidgetState = widget.initialState;`
			];
			for (let i = 6; i < linesPer; i++) {
				const kind = i % 5;
				if (kind === 0) lines.push(`	const widget${i} = createWidget(widget, ${i});`);
				else if (kind === 1) lines.push(`	state = widget.reduce(state, widget${i});`);
				else if (kind === 2) lines.push(`	logger.debug('widget ${i}', widget${i});`);
				else if (kind === 3) lines.push(`	if (widget.active) state.widgetCount += ${i};`);
				else lines.push(`	// keep widget ${i} in sync with downstream consumers`);
			}
			lines.push(`	return { widget, state };`, `}`);
			const newContents = lines.join('\n') + '\n';
			const patch = `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') + '\n';
			fixtures.push({
				file: {
					path: `src/features/module-${String(k >> 3).padStart(3, '0')}/widget-${k}.ts`,
					status: 'added',
					additions: lines.length,
					deletions: 0,
					isBinary: false
				},
				patch,
				oldContents: '',
				newContents,
				truncated: false
			});
		}
		const totalMatches = fixtures.reduce(
			(n, f) => n + (f.newContents.match(/widget/gi) ?? []).length,
			0
		);
		return { token: 'widget', totalMatches, fixtures };
	}

	const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
	const fileParam = Number(params?.get('files') ?? 0);
	const linesParam = Number(params?.get('lines') ?? 0) || 120;
	const data = fileParam > 0 ? synthFixtures(fileParam, linesParam) : committed;

	const REPO = { id: 'repo1', path: '/tmp/demo-repo', name: 'demo-repo' };
	const CTX = { kind: 'workingTree' as const };

	// ── Mock window.api ───────────────────────────────────────────────────────
	// A deep, callable proxy: every namespace/method that the store or components
	// reach for resolves to an async no-op, except the handful we implement.
	function installApiMock(): void {
		if (typeof window === 'undefined') return;
		const byPath = new Map(data.fixtures.map((f) => [f.file.path, f]));

		const asyncNoop = () => Promise.resolve(undefined);
		const branch = (overrides: Record<string, unknown> = {}): unknown =>
			new Proxy(asyncNoop as object, {
				get(_t, prop) {
					if (typeof prop === 'string' && prop in overrides) return overrides[prop];
					return branch();
				},
				apply: () => Promise.resolve(undefined)
			});

		const api = branch({
			platform: 'darwin',
			git: branch({
				getDiff: async (_repoId: string, path: string, _ctx: unknown) => {
					// Simulate IPC latency so the lazy fetch path behaves like the app.
					await new Promise((r) => setTimeout(r, 60));
					return byPath.get(path) ?? null;
				}
			}),
			state: branch({
				setPrefs: asyncNoop,
				getPrefs: async () => ({}),
				setFileCollapsed: asyncNoop,
				setFileSeen: asyncNoop,
				getCollapsedFiles: async () => [],
				getSeenFiles: async () => [],
				getSeenSignatures: async () => ({}),
				getBranchBase: async () => null,
				getCachedFileList: async () => null,
				getCommitDraft: async () => null
			})
		});

		(window as unknown as { api: unknown }).api = api;
	}
	installApiMock();

	// ── Seed the store ────────────────────────────────────────────────────────
	// Pre-collapse every 4th file so we can test "navigate to a match expands the
	// collapsed file". Pre-cache half the diffs so some sections render instantly
	// and the rest exercise the lazy getDiff + preload path.
	const collapsedPaths = data.fixtures.filter((_, i) => i % 4 === 1).map((f) => f.file.path);

	onMount(() => {
		initDiffWorkerPool();
		app.activeRepo = REPO as never;
		app.diffContext = CTX as never;
		app.contextTab = 'unstaged';
		app.theme = 'light';
		app.viewMode = 'unified';
		app.diffLayout = 'scroll';
		app.changedFiles = data.fixtures.map((f) => f.file) as never;
		for (const p of collapsedPaths) app.collapsedFiles.add(p);
		// Default (committed) set: pre-cache half so the rest exercises the lazy
		// getDiff + preload path. Synthetic stress set (`?files=`): pre-cache ALL so
		// we stress the index/render under load without waiting on thousands of
		// mock IPC round-trips.
		const preCache = fileParam > 0 ? data.fixtures : data.fixtures.slice(0, 30);
		preCache.forEach((f) => setCachedDiff(REPO.id, CTX as never, f.file.path, f as never));

		// Debug surface for the preview harness: lets eval inspect find internals
		// and jump deterministically to a given file's first match.
		(window as unknown as { __dbg: unknown }).__dbg = {
			find,
			app,
			sections,
			index: _findIndex,
			collapsedPaths,
			isCached: (path: string) => !!getCachedDiff(REPO.id, CTX as never, path),
			matchCount: () => _findIndex.matchCount,
			flatIndexOf: (path: string) => _findIndex.firstFlatIndexForFile(path),
			// Position currentIndex just before a file's first match, then Next into
			// it — exercises the real navigateTo path for that (possibly collapsed) file.
			jumpToFile(path: string) {
				const idx = _findIndex.firstFlatIndexForFile(path);
				if (idx < 0) return { ok: false, reason: 'no match for ' + path };
				find.currentIndex = idx - 1;
				nextMatch();
				return { ok: true, targetFlatIndex: idx };
			}
		};
	});

	// ── Live instrumentation ──────────────────────────────────────────────────
	let allSize = $state(0);
	let currentSize = $state(0);
	let lastNavMs = $state(0);
	let hammerReport = $state('');

	function readHighlightSizes(): void {
		const hl = (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights;
		allSize = hl?.get('sr-find-match')?.size ?? 0;
		currentSize = hl?.get('sr-find-current')?.size ?? 0;
	}
	onMount(() => {
		const id = setInterval(readHighlightSizes, 100);
		return () => clearInterval(id);
	});

	// The preview/headless browser's IntersectionObserver doesn't deliver
	// scroll-container-root callbacks reliably, so file sections never flip
	// `inView` on their own here. Drive it deterministically from geometry: this
	// mirrors what the real IntersectionObserver does in Electron (600px margin),
	// so the find code paths run against accurate inView state. Harness-only.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const lastInView = new Map<HTMLElement, boolean>();
	function syncInViewFromGeometry(): void {
		const sc = document.querySelector('.overflow-auto') as HTMLElement | null;
		if (!sc) return;
		const r = sc.getBoundingClientRect();
		const top = r.top - 600;
		const bottom = r.bottom + 600;
		for (const sec of document.querySelectorAll<
			HTMLElement & { __setInView?: (v: boolean) => void }
		>('section[data-file-path]')) {
			const rect = sec.getBoundingClientRect();
			const visible = rect.bottom > top && rect.top < bottom;
			if (lastInView.get(sec) === visible) continue;
			lastInView.set(sec, visible);
			sec.__setInView?.(visible);
		}
	}
	onMount(() => {
		const id = setInterval(syncInViewFromGeometry, 120);
		const sc = document.querySelector('.overflow-auto');
		sc?.addEventListener('scroll', syncInViewFromGeometry, { passive: true });
		return () => {
			clearInterval(id);
			sc?.removeEventListener('scroll', syncInViewFromGeometry);
		};
	});

	function searchWidget(): void {
		openFind();
		setQuery('widget');
	}

	function timedNext(): void {
		const t = performance.now();
		nextMatch();
		lastNavMs = Math.round((performance.now() - t) * 100) / 100;
	}

	// Hammer: fire nextMatch many times in a tight loop (simulating mashing the
	// button / Enter) and report how many "current" ranges survive afterwards.
	// More than one means the async navigations raced and left duplicate pins.
	async function hammerNext(times: number): Promise<void> {
		const t = performance.now();
		for (let i = 0; i < times; i++) nextMatch();
		const sync = Math.round((performance.now() - t) * 100) / 100;
		await new Promise((r) => setTimeout(r, 1200));
		readHighlightSizes();
		hammerReport = `fired ${times}× in ${sync}ms (sync). After settle: current pins=${currentSize}, index=${find.currentIndex}`;
	}

	// Reassign app.changedFiles with FRESH file objects (same paths) — exactly
	// what the store does on a focus/poll/git refresh. This used to make every
	// DiffFileSection's find-registration effect re-run and reset renderEpoch to
	// 0, so find stopped painting highlights. Use it to prove highlights survive.
	function churnFiles(): void {
		app.changedFiles = data.fixtures.map((f) => ({ ...f.file })) as never;
	}
</script>

<svelte:head><title>Find debug harness</title></svelte:head>

<div class="flex h-screen flex-col bg-background text-foreground">
	<div class="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 text-xs">
		<strong class="text-sm">Find harness</strong>
		<span class="text-muted-foreground"
			>{data.fixtures.length} files · ~{data.totalMatches} "widget" tokens</span
		>
		<button class="rounded border border-border px-2 py-1 hover:bg-accent" onclick={searchWidget}>
			Open + search "widget"
		</button>
		<button class="rounded border border-border px-2 py-1 hover:bg-accent" onclick={timedNext}
			>Next (timed)</button
		>
		<button class="rounded border border-border px-2 py-1 hover:bg-accent" onclick={prevMatch}
			>Prev</button
		>
		<button class="rounded border border-border px-2 py-1 hover:bg-accent" onclick={churnFiles}
			>Churn files</button
		>
		<button
			class="rounded border border-border px-2 py-1 hover:bg-accent"
			onclick={() => hammerNext(10)}
		>
			Hammer Next ×10
		</button>
		<button
			class="rounded border border-border px-2 py-1 hover:bg-accent"
			onclick={() => hammerNext(30)}
		>
			Hammer Next ×30
		</button>
		<button class="rounded border border-border px-2 py-1 hover:bg-accent" onclick={closeFind}
			>Close</button
		>
		<span class="ml-auto flex gap-3 font-mono">
			<span>open={String(find.open)}</span>
			<span>count={find.matchCount}</span>
			<span>idx={find.currentIndex}</span>
			<span class:text-destructive={currentSize > 1}>currentPins={currentSize}</span>
			<span>yellowRanges={allSize}</span>
			<span>lastNav={lastNavMs}ms</span>
		</span>
	</div>
	{#if hammerReport}
		<div
			class="border-b border-border bg-card px-3 py-1 font-mono text-xs"
			class:text-destructive={currentSize > 1}
		>
			{hammerReport}
		</div>
	{/if}
	<div class="min-h-0 flex-1">
		<DiffView />
	</div>
</div>
