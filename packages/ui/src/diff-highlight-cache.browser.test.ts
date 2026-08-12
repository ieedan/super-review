import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './test/DiffFindHarness.svelte';
import { app } from '@super-review/ui/store.svelte';
import { diffCache } from '@super-review/ui/store-cache';
import { getDiffWorkerPool, initDiffWorkerPool } from '@super-review/ui/diff-worker-pool';
import {
	diffFilePair,
	parseDiffMetadata,
	primeDiffHighlight
} from '@super-review/ui/diff-highlight-cache';
import type { DiffData } from '@super-review/core/types';

// Pierre paints a diff in two passes: a synchronous plain-text paint, then a
// repaint once the worker pool returns the highlighted AST. Its cache exists to
// skip the second pass, but it is keyed solely off `FileDiffMetadata.cacheKey`,
// which `parseDiffFromFile` only produces when both file objects carry one — and
// the diff renderer used to pass bare `{ name, contents }` pairs. So the cache
// could never hit, priming was impossible, and every diff flashed plain text
// while it re-tokenized from scratch.
//
// These tests run in a real browser because they need the actual Web Worker
// pool, Pierre's shadow-DOM render, and animation-frame timing.

function tsFixture(path: string, lines = 400): DiffData {
	const body: string[] = [`import { compute, transform } from './lib';`];
	for (let i = 0; i < lines; i++) {
		const kind = i % 4;
		if (kind === 0) body.push(`export function handler${i}(input: number): number {`);
		else if (kind === 1) body.push(`	const total = compute(input) * ${i};`);
		else if (kind === 2) body.push(`	return transform(total, { scale: ${i}, label: 'row-${i}' });`);
		else body.push(`}`);
	}
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

// The metadata the renderer will use, so we can look this diff up in the worker
// pool's highlight cache.
function metaFor(diff: DiffData) {
	const { oldFile, newFile } = diffFilePair(diff);
	return parseDiffMetadata(oldFile, newFile);
}

function shadowRootOf(filePath: string): ShadowRoot | null {
	const sec = document.querySelector(`section[data-file-path="${CSS.escape(filePath)}"]`);
	if (!sec) return null;
	for (const el of sec.querySelectorAll('*')) if (el.shadowRoot) return el.shadowRoot;
	return null;
}

// Highlighted tokens carry Shiki's dual-theme colours as custom properties. A
// plain paint emits the same line structure with no such tokens, so their
// presence is exactly "this diff is syntax-highlighted right now".
function highlightedTokenCount(root: ShadowRoot): number {
	return root.querySelectorAll('span[style*="--diffs-token-"]').length;
}

function hasCodeLines(root: ShadowRoot): boolean {
	return root.querySelector('[data-line]') != null;
}

// Sample every animation frame for `ms` and report whether the diff was ever on
// screen unhighlighted — the plain-text flash the reviewer sees — and whether it
// ended up highlighted at all.
async function watchFirstPaint(
	filePath: string,
	ms: number
): Promise<{ sawPlain: boolean; endedHighlighted: boolean }> {
	let sawPlain = false;
	const deadline = performance.now() + ms;
	while (performance.now() < deadline) {
		const root = shadowRootOf(filePath);
		if (root && hasCodeLines(root) && highlightedTokenCount(root) === 0) sawPlain = true;
		await new Promise((r) => requestAnimationFrame(() => r(null)));
	}
	const root = shadowRootOf(filePath);
	return { sawPlain, endedHighlighted: root != null && highlightedTokenCount(root) > 0 };
}

afterEach(() => {
	app.seenFiles.clear();
	app.collapsedFiles.clear();
	app.selectedFile = null;
	app.firstVisibleUnseenFile = null;
	diffCache.clear();
});

describe('diff highlight cache', () => {
	it('gives the parsed metadata a content-derived cache key', () => {
		const diff = tsFixture('src/keyed.ts', 20);
		const { oldFile, newFile } = diffFilePair(diff);
		expect(oldFile.cacheKey).toBeTruthy();
		expect(newFile.cacheKey).toBeTruthy();

		// Without a key on both sides Pierre hands back `cacheKey: undefined`, and
		// its whole diff cache silently no-ops. This is the fix.
		const meta = parseDiffMetadata(oldFile, newFile);
		expect(meta?.cacheKey).toBe(`${oldFile.cacheKey}:${newFile.cacheKey}`);
	});

	it('keys by content, not by path or identity', () => {
		const a = tsFixture('src/same.ts', 20);
		const b = tsFixture('src/same.ts', 20);
		expect(diffFilePair(a).newFile.cacheKey).toBe(diffFilePair(b).newFile.cacheKey);

		// Same bytes under a different name must NOT share a key: highlighting is
		// language-driven, so a `.ts` and a `.txt` AST are not interchangeable.
		const renamed = { ...a, file: { ...a.file, path: 'src/other.txt' } } as DiffData;
		expect(diffFilePair(renamed).newFile.cacheKey).not.toBe(diffFilePair(a).newFile.cacheKey);

		// Changed content changes the key, so an edit can't serve a stale AST.
		const edited = { ...a, newContents: a.newContents + 'const extra = 1;\n' } as DiffData;
		expect(diffFilePair(edited).newFile.cacheKey).not.toBe(diffFilePair(a).newFile.cacheKey);
	});

	it('reuses the parsed metadata for identical content', () => {
		const diff = tsFixture('src/memo.ts', 20);
		const first = metaFor(diff);
		const second = metaFor(diff);
		// Same object: the second render skips `createTwoFilesPatch` entirely.
		expect(second).toBe(first);
	});

	it('populates the worker pool cache when primed', async () => {
		initDiffWorkerPool();
		const pool = getDiffWorkerPool();
		expect(pool?.isWorkingPool()).toBe(true);

		const diff = tsFixture('src/primed.ts');
		const { oldFile, newFile } = diffFilePair(diff);
		const meta = parseDiffMetadata(oldFile, newFile)!;
		expect(pool!.getDiffResultCache(meta)).toBeUndefined();

		primeDiffHighlight(diff);

		await vi.waitFor(() => expect(pool!.getDiffResultCache(meta)).toBeDefined(), {
			timeout: 10000
		});
	});

	it('paints highlighted from the first frame when the diff was primed', async () => {
		initDiffWorkerPool();
		const pool = getDiffWorkerPool()!;

		const diff = tsFixture('src/warm.ts');
		const meta = metaFor(diff)!;

		// Warm the workers before anything renders — this is what the store's
		// prefetch does while the reviewer is still reading the previous file.
		primeDiffHighlight(diff);
		await vi.waitFor(() => expect(pool.getDiffResultCache(meta)).toBeDefined(), {
			timeout: 10000
		});

		render(Harness, { props: { fixtures: [diff] } });

		// Watch every frame from the mount onward. With the cache warm, Pierre's
		// renderer picks the highlighted AST up in `hydrate` and the very first
		// paint is already coloured — there is no plain-text frame to catch.
		const seen = await watchFirstPaint('src/warm.ts', 1500);
		expect(seen.endedHighlighted).toBe(true);
		expect(seen.sawPlain).toBe(false);
	});
});
