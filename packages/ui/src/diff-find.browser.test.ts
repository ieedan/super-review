import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './test/DiffFindHarness.svelte';
import {
	find,
	openFind,
	closeFind,
	setQuery,
	nextMatch,
	_findIndex
} from '@super-review/ui/diff-find.svelte';
import { app } from '@super-review/ui/store.svelte';
import type { DiffData } from '@super-review/core/types';

// These tests run in a REAL browser (Playwright/Chromium) because the find bugs
// all lived in the glue between Svelte reactivity, Pierre's shadow-DOM render,
// the IntersectionObserver, and the CSS Custom Highlight API — none of which
// exist in jsdom. The pure index logic is covered separately by the fast Node
// unit tests in diff-find-index.test.ts.

// Build N "added" file fixtures whose diff is all-additions, so find's patch scan
// and Pierre's render agree, and 'widget' appears many times per file.
function buildFixtures(count: number, linesPer = 60): DiffData[] {
	const out: DiffData[] = [];
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
		out.push({
			file: {
				path: `src/features/module-${k >> 3}/widget-${k}.ts`,
				status: 'added',
				additions: lines.length,
				deletions: 0,
				isBinary: false
			},
			patch,
			oldContents: '',
			newContents,
			truncated: false
		} as DiffData);
	}
	return out;
}

// A single all-additions file fixture at `path` whose every line contains
// `token`, so find's patch scan picks it up. Used to probe which files the
// controller folds into its index.
function tokenFixture(path: string, token: string, lines = 12): DiffData {
	const body: string[] = [];
	for (let i = 0; i < lines; i++) body.push(`const ${token}${i} = ${token}(${i});`);
	const newContents = body.join('\n') + '\n';
	const patch = `@@ -0,0 +1,${body.length} @@\n` + body.map((l) => '+' + l).join('\n') + '\n';
	return {
		file: { path, status: 'added', additions: body.length, deletions: 0, isBinary: false },
		patch,
		oldContents: '',
		newContents,
		truncated: false
	} as DiffData;
}

// Snapshot of the find highlight state straight from the CSS Custom Highlight
// registry — the same thing the user sees painted.
function highlightState(): { yellow: number; current: number; connected: boolean } {
	const reg = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
	const cur = reg.get('sr-find-current');
	let connected = false;
	if (cur) {
		for (const r of cur) {
			if (r.startContainer?.isConnected) {
				connected = true;
				break;
			}
		}
	}
	return { yellow: reg.get('sr-find-match')?.size ?? 0, current: cur?.size ?? 0, connected };
}

// Is the current orange pin painted inside the given file's rendered diff?
function pinInFile(path: string): boolean {
	const sec = document.querySelector(`section[data-file-path="${CSS.escape(path)}"]`);
	if (!sec) return false;
	let host: Element | null = null;
	for (const el of sec.querySelectorAll('*')) {
		if (el.shadowRoot) {
			host = el;
			break;
		}
	}
	if (!host) return false;
	const cur = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(
		'sr-find-current'
	);
	if (!cur) return false;
	for (const r of cur) {
		try {
			if (host.shadowRoot!.contains(r.startContainer)) return true;
		} catch {
			/* range may be detached */
		}
	}
	return false;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
	closeFind();
});

describe('find: highlighting in the real diff view', () => {
	it('paints yellow matches and exactly one current pin on search', async () => {
		render(Harness, { props: { fixtures: buildFixtures(6) } });
		openFind();
		setQuery('widget');

		await vi.waitFor(() => expect(find.matchCount).toBeGreaterThan(0), { timeout: 8000 });
		await vi.waitFor(
			() => {
				const s = highlightState();
				expect(s.yellow).toBeGreaterThan(0);
				expect(s.current).toBe(1);
				expect(s.connected).toBe(true);
			},
			{ timeout: 8000 }
		);
	});

	it('keeps exactly one current pin when stepping rapidly (no duplicate-pin race)', async () => {
		render(Harness, { props: { fixtures: buildFixtures(8) } });
		openFind();
		setQuery('widget');
		await vi.waitFor(() => expect(highlightState().current).toBe(1), { timeout: 8000 });

		// Mash Next — the old async navigation left several stale pins painted.
		for (let i = 0; i < 25; i++) nextMatch();

		await vi.waitFor(() => expect(find.currentIndex).toBeGreaterThan(0), { timeout: 8000 });
		await vi.waitFor(() => expect(highlightState().current).toBe(1), { timeout: 8000 });
		expect(highlightState().connected).toBe(true);
	});

	it('repaints the pin after the diff DOM is rebuilt (Pierre rerender class)', async () => {
		render(Harness, { props: { fixtures: buildFixtures(4) } });
		openFind();
		setQuery('widget');
		await vi.waitFor(
			() => {
				const s = highlightState();
				expect(s.current).toBe(1);
				expect(s.connected).toBe(true);
			},
			{ timeout: 8000 }
		);

		// Force the diff DOM to be torn down and rebuilt. The bug: the painted Range
		// dangled on the replaced text nodes (rangeConnected: null) so the pin
		// vanished until a tab switch. The fix repaints on bumpRenderEpoch.
		app.viewMode = 'split';
		await wait(50);
		await vi.waitFor(
			() => {
				const s = highlightState();
				expect(s.current).toBe(1);
				expect(s.connected).toBe(true);
				expect(s.yellow).toBeGreaterThan(0);
			},
			{ timeout: 8000 }
		);
		app.viewMode = 'unified';
	});

	it('updates highlights when the query changes', async () => {
		render(Harness, { props: { fixtures: buildFixtures(5) } });
		openFind();
		setQuery('widget');
		await vi.waitFor(() => expect(highlightState().yellow).toBeGreaterThan(0), { timeout: 8000 });

		setQuery('reduce'); // a rarer token, present in fewer lines
		await vi.waitFor(() => expect(find.query).toBe('reduce'), { timeout: 8000 });
		await vi.waitFor(
			() => {
				expect(find.matchCount).toBeGreaterThan(0);
				const s = highlightState();
				expect(s.yellow).toBeGreaterThan(0);
				expect(s.current).toBe(1);
				expect(s.connected).toBe(true);
			},
			{ timeout: 8000 }
		);
	});

	it('keeps rendered highlights alive across find-state changes (untrack regression)', async () => {
		render(Harness, { props: { fixtures: buildFixtures(5) } });
		openFind();
		setQuery('widget');
		await vi.waitFor(() => expect(highlightState().yellow).toBeGreaterThan(0), { timeout: 8000 });

		// Churn find state the way typing + navigating does. Pre-fix, notifySectionState
		// (called from the sections' $effects) TRACKED find state, so every change
		// re-ran the registration/render effect, reset renderEpoch, and dropped the
		// built ranges — yellow fell to 0 until a tab switch. untrack keeps them.
		for (const q of ['widge', 'widget', 'widgetF', 'widget']) {
			setQuery(q);
			await wait(120);
		}
		nextMatch();
		nextMatch();
		await wait(250);

		const s = highlightState();
		expect(s.yellow).toBeGreaterThan(0);
		expect(s.current).toBe(1);
		expect(s.connected).toBe(true);
	});

	it('skips an unopened super-review session manifest (find never folds in its JSON)', async () => {
		// A normal file and a `.super-review/sessions/*.json` manifest, both
		// uncached so find's preload is the only thing that could fetch them. The
		// manifest is deferred to a card by the default hidden pattern, so its
		// section never auto-fetches either — preload is its ONLY route into the
		// index, and the fix makes preload skip it.
		const normal = tokenFixture('src/features/zebra-service.ts', 'zebra');
		const manifest = tokenFixture('.super-review/sessions/sess-zebra.json', 'zebra');
		render(Harness, {
			props: {
				fixtures: [normal, manifest],
				uncached: [normal.file.path, manifest.file.path]
			}
		});
		openFind();
		setQuery('zebra');

		// Preload folds the normal file in; wait for that so we know the preload
		// cycle has run, then confirm the manifest was passed over.
		await vi.waitFor(() => expect(_findIndex.hasFile(normal.file.path)).toBe(true), {
			timeout: 8000
		});
		await wait(400);
		expect(_findIndex.hasFile(manifest.file.path)).toBe(false);
		expect(_findIndex.firstFlatIndexForFile(manifest.file.path)).toBe(-1);
	});

	it('includes a session manifest once it has been opened (its diff is cached)', async () => {
		// A cached manifest stands in for one the user opened via "View raw": its
		// diff is in the cache, so find folds it in like any other opened file.
		const manifest = tokenFixture('.super-review/sessions/sess-open.json', 'zebra');
		render(Harness, { props: { fixtures: [manifest] } });
		openFind();
		setQuery('zebra');

		await vi.waitFor(() => expect(_findIndex.hasFile(manifest.file.path)).toBe(true), {
			timeout: 8000
		});
		expect(find.matchCount).toBeGreaterThan(0);
	});

	it('expands a collapsed file and pins the match inside it', async () => {
		const fixtures = buildFixtures(6);
		const collapsedPath = fixtures[3].file.path;
		render(Harness, { props: { fixtures, collapsed: [collapsedPath] } });
		openFind();
		setQuery('widget');
		await vi.waitFor(() => expect(find.matchCount).toBeGreaterThan(0), { timeout: 8000 });
		expect(app.collapsedFiles.has(collapsedPath)).toBe(true);

		// Jump to the collapsed file's first match (mirrors nextMatch landing there).
		const flat = _findIndex.firstFlatIndexForFile(collapsedPath);
		expect(flat).toBeGreaterThanOrEqual(0);
		find.currentIndex = flat - 1;
		nextMatch();

		await vi.waitFor(() => expect(app.collapsedFiles.has(collapsedPath)).toBe(false), {
			timeout: 8000
		});
		await vi.waitFor(
			() => {
				expect(highlightState().current).toBe(1);
				expect(pinInFile(collapsedPath)).toBe(true);
			},
			{ timeout: 8000 }
		);
	});
});
