import { describe, it, expect, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import Harness from './test/DiffFindHarness.svelte';
import { app, actions, getCachedDiff } from '@super-review/ui/store.svelte';
import { diffCache } from '@super-review/ui/store-cache';
import { getDiffWorkerPool, initDiffWorkerPool } from '@super-review/ui/diff-worker-pool';
import { diffFilePair, parseDiffMetadata } from '@super-review/ui/diff-highlight-cache';
import type { DiffData } from '@super-review/core/types';

// "Mark seen" advances the reviewer to the next unseen file. These tests cover
// the two halves of making that jump land on a rendered diff instead of a
// "Loading diff…" placeholder: the store prefetching the predicted target's diff
// ahead of the click, and the diff view rendering it on arrival rather than
// queueing behind every section the jump swept past.
//
// They run in a REAL browser for the same reason the find tests do — the
// behaviour lives in the glue between Svelte reactivity, the
// IntersectionObserver, and Pierre's shadow-DOM render, none of which exist in
// jsdom. In particular the prediction is driven by where the reviewer actually
// is: the tests scroll the real container and let the diff view's own scroll
// handler decide the position, rather than assigning it.

const REPO_ID = 'repo1';
const CTX = { kind: 'workingTree' as const };

function fileFixture(path: string, lines = 40): DiffData {
	const body: string[] = [];
	for (let i = 0; i < lines; i++) body.push(`const value${i} = compute(${i});`);
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

function buildFixtures(count: number): DiffData[] {
	return Array.from({ length: count }, (_, k) => fileFixture(`src/module-${k}.ts`));
}

const path = (k: number): string => `src/module-${k}.ts`;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const cached = (p: string): DiffData | undefined => getCachedDiff(REPO_ID, CTX as never, p);

// Put the reviewer on a file for real — scroll to it and wait for the diff
// view's scroll handler to agree that's the first on-screen unseen file, which
// is the position both mark-seen affordances act from.
async function positionOn(p: string): Promise<void> {
	actions.scrollToFile(p);
	await vi.waitFor(() => expect(app.firstVisibleUnseenFile).toBe(p), { timeout: 5000 });
}

// Does this file's section have a real rendered diff in the DOM? Pierre renders
// into a shadow root, so "has a shadow host with content in it" is the honest
// test for "the reviewer can actually read this diff" — it separates a rendered
// section from both a placeholder and the blank 0×0 render you get from
// rendering into a hidden host.
function renderedDiffText(filePath: string): string | null {
	const sec = document.querySelector(`section[data-file-path="${CSS.escape(filePath)}"]`);
	if (!sec) return null;
	for (const el of sec.querySelectorAll('*')) {
		if (el.shadowRoot) return el.shadowRoot.textContent ?? '';
	}
	return null;
}

function shadowRootOf(filePath: string): ShadowRoot | null {
	const sec = document.querySelector(`section[data-file-path="${CSS.escape(filePath)}"]`);
	if (!sec) return null;
	for (const el of sec.querySelectorAll('*')) if (el.shadowRoot) return el.shadowRoot;
	return null;
}

// Shiki's dual-theme token colours; their presence means "highlighted right now".
function highlightedTokenCount(root: ShadowRoot): number {
	return root.querySelectorAll('span[style*="--diffs-token-"]').length;
}

// The metadata the renderer will use, so we can look this diff up in the worker
// pool's highlight cache.
function metaFor(diff: DiffData) {
	const { oldFile, newFile } = diffFilePair(diff);
	return parseDiffMetadata(oldFile, newFile);
}

function sectionText(filePath: string): string {
	const sec = document.querySelector(`section[data-file-path="${CSS.escape(filePath)}"]`);
	return sec?.textContent ?? '';
}

afterEach(() => {
	// The store and the diff cache are module singletons shared across tests.
	app.seenFiles.clear();
	app.collapsedFiles.clear();
	app.selectedFile = null;
	app.firstVisibleUnseenFile = null;
	app.fileSearchQuery = '';
	diffCache.clear();
});

describe('mark seen: prefetching the file the advance will open', () => {
	it('primes the diff cache for the next unseen file, well off screen', async () => {
		const fixtures = buildFixtures(30);
		// Nothing pre-cached: the only way a diff reaches the cache is a fetch.
		render(Harness, { props: { fixtures, uncached: fixtures.map((f) => f.file.path) } });

		// Files 1-19 are already reviewed, so the advance from file 0 skips them and
		// lands on file 20 — far below the viewport and its 600px observer margin,
		// where no section of its own would ever fetch.
		for (let k = 1; k < 20; k++) app.seenFiles.add(path(k));
		await positionOn(path(0));

		await vi.waitFor(() => expect(cached(path(20))).toBeDefined(), { timeout: 5000 });
		// Never rendered — the prefetch, not an in-view fetch, is what cached it.
		expect(renderedDiffText(path(20))).toBeNull();
	});

	it('predicts the same file the advance actually opens', async () => {
		const fixtures = buildFixtures(30);
		render(Harness, { props: { fixtures, uncached: fixtures.map((f) => f.file.path) } });

		for (let k = 1; k < 20; k++) app.seenFiles.add(path(k));
		await positionOn(path(0));
		await vi.waitFor(() => expect(cached(path(20))).toBeDefined(), { timeout: 5000 });

		await actions.markSeenAndAdvance(path(0));
		expect(app.selectedFile).toBe(path(20));
	});

	it('wraps to the first unseen file above when everything below is seen', async () => {
		const fixtures = buildFixtures(30);
		render(Harness, { props: { fixtures, uncached: fixtures.map((f) => f.file.path) } });

		// Files 3 and 25 are the only unseen ones left. Standing on 25 there is
		// nothing unseen below it, so the advance wraps back up to 3 — proving the
		// prefetch shares the advance's wrap-around rule instead of only looking down.
		for (let k = 0; k < 30; k++) if (k !== 3 && k !== 25) app.seenFiles.add(path(k));
		await positionOn(path(25));

		await vi.waitFor(() => expect(cached(path(3))).toBeDefined(), { timeout: 5000 });
	});

	it('skips files whose diffs are hidden behind "Load diff"', async () => {
		// A lock file matches the default hidden patterns, so its section shows a
		// "Load diff" button and never fetches. Prefetching it would pull a large
		// diff that nothing is going to render.
		const fixtures = [
			...buildFixtures(3),
			fileFixture('pnpm-lock.yaml', 200),
			fileFixture('src/module-9.ts')
		];
		render(Harness, { props: { fixtures, uncached: fixtures.map((f) => f.file.path) } });

		for (let k = 1; k < 3; k++) app.seenFiles.add(path(k));
		await positionOn(path(0));

		// Room for the debounce plus a fetch round trip, had one been started.
		await wait(1200);
		expect(cached('pnpm-lock.yaml')).toBeUndefined();
	});
});

describe('mark seen: the advance lands on a rendered diff', () => {
	it('renders the target instead of stranding it on a placeholder', async () => {
		const fixtures = buildFixtures(30);
		render(Harness, { props: { fixtures, uncached: fixtures.map((f) => f.file.path) } });

		for (let k = 1; k < 20; k++) app.seenFiles.add(path(k));
		await positionOn(path(0));
		await vi.waitFor(() => expect(cached(path(20))).toBeDefined(), { timeout: 5000 });
		// Starting point: the target is off screen with no rendered DOM at all.
		expect(renderedDiffText(path(20))).toBeNull();

		await actions.markSeenAndAdvance(path(0));

		// Deliberately microtasks only — no waitFor, no timers. `tick()` flushes
		// Svelte effects without ever yielding to an animation frame, so the diff can
		// only be here if the diff view rendered it in place on arrival. The ordinary
		// lazy path cannot have run: it needs an IntersectionObserver callback (a
		// task) and then a `requestAnimationFrame` from the render scheduler. This is
		// the whole point of the fast lane — the file the reviewer asked for must not
		// queue behind every section the jump swept past.
		await tick();
		await tick();
		await tick();

		const text = renderedDiffText(path(20));
		expect(text).not.toBeNull();
		// Non-empty shadow content: a real diff, not the blank 0×0 render you get
		// from rendering into a hidden host.
		expect(text).toContain('compute');
		expect(sectionText(path(20))).not.toContain('Loading diff');
		expect(sectionText(path(20))).not.toContain('Scroll to load');
	});

	it('lands on a highlighted diff, with no plain-text flash', async () => {
		// The end-to-end claim: by the time the reviewer arrives, both slow stages
		// are already done — the diff was fetched and its syntax highlighting was
		// tokenized on a worker while they were still reading the previous file.
		// Pierre's default is a plain-text paint followed by a highlighted repaint,
		// which is what this asserts is gone.
		initDiffWorkerPool();
		const pool = getDiffWorkerPool()!;
		const fixtures = buildFixtures(30);
		render(Harness, { props: { fixtures, uncached: fixtures.map((f) => f.file.path) } });

		for (let k = 1; k < 20; k++) app.seenFiles.add(path(k));
		await positionOn(path(0));

		// The prefetch fetches the diff and then primes the highlight off it; wait
		// for both, which is the head start reading the current file buys in the app.
		await vi.waitFor(() => expect(cached(path(20))).toBeDefined(), { timeout: 5000 });
		const meta = metaFor(cached(path(20))!)!;
		await vi.waitFor(() => expect(pool.getDiffResultCache(meta)).toBeDefined(), {
			timeout: 10000
		});

		await actions.markSeenAndAdvance(path(0));

		let sawPlain = false;
		const deadline = performance.now() + 1200;
		while (performance.now() < deadline) {
			const root = shadowRootOf(path(20));
			if (root?.querySelector('[data-line]') && highlightedTokenCount(root) === 0) sawPlain = true;
			await new Promise((r) => requestAnimationFrame(() => r(null)));
		}
		expect(highlightedTokenCount(shadowRootOf(path(20))!)).toBeGreaterThan(0);
		expect(sawPlain).toBe(false);
	});

	it('renders a collapsed target after the advance expands it', async () => {
		// `scrollToFile` expands the target in the same tick it raises the scroll
		// request. A section still wrapped in `hidden` has a `display:none` host, and
		// rendering into one makes Pierre measure it 0×0 and paint a permanently
		// blank diff — so the fast lane refuses to run there. Letting the expand
		// flush first is what keeps the fast lane available to a collapsed target
		// instead of silently dropping it back onto the slow lazy path.
		const fixtures = buildFixtures(30);
		render(Harness, {
			props: {
				fixtures,
				uncached: fixtures.map((f) => f.file.path),
				collapsed: [path(20)]
			}
		});

		for (let k = 1; k < 20; k++) app.seenFiles.add(path(k));
		await positionOn(path(0));
		await vi.waitFor(() => expect(cached(path(20))).toBeDefined(), { timeout: 5000 });

		await actions.markSeenAndAdvance(path(0));

		// Microtasks only, as above: rendered by the time the effects settle means
		// the fast lane ran, not the animation-frame-driven lazy path.
		await tick();
		await tick();
		await tick();

		expect(app.collapsedFiles.has(path(20))).toBe(false);
		expect(renderedDiffText(path(20))).toContain('compute');
	});
});
