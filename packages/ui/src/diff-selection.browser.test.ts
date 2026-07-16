import { describe, it, expect, afterEach, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Harness from './test/DiffFindHarness.svelte';
import type { DiffData } from '@super-review/core/types';

// Selection-occurrence highlighting (diff-selection.ts) runs in a REAL browser
// for the same reason the find tests do: the whole feature is glue between the
// document selection, Pierre's shadow DOM, and the CSS Custom Highlight API,
// none of which exist in jsdom. The harness mounts the real DiffView, which
// installs the selectionchange listener via initSelectionHighlight.

const SELECTION_HIGHLIGHT = 'sr-selection-occurrence';

// Two files that share an identifier, so cross-file scoping is observable:
// selecting `alphaToken` in file 0 must NOT light up its occurrences in file 1.
function buildFixtures(): DiffData[] {
	const out: DiffData[] = [];
	for (let k = 0; k < 2; k++) {
		const lines = [
			`export function setup${k}(alphaToken: number) {`,
			`	const doubled = alphaToken * 2;`,
			`	const tripled = alphaToken * 3;`,
			`	const uniqueOnce${k} = doubled + tripled;`,
			`	return { alphaToken, doubled, tripled, uniqueOnce${k} };`,
			`}`
		];
		const newContents = lines.join('\n') + '\n';
		const patch = `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') + '\n';
		out.push({
			file: {
				path: `src/mod-${k}/service-${k}.ts`,
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

function highlightRanges(): Range[] {
	const reg = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
	return [...(reg.get(SELECTION_HIGHLIGHT) ?? [])];
}

// Find a text node containing `needle` inside the given file section's shadow
// DOM (skipping Pierre's gutter, where line numbers live).
function shadowTextNode(filePath: string, needle: string): Text | null {
	const sec = document.querySelector(`section[data-file-path="${CSS.escape(filePath)}"]`);
	if (!sec) return null;
	for (const el of sec.querySelectorAll('*')) {
		if (!el.shadowRoot) continue;
		const walker = document.createTreeWalker(el.shadowRoot, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const t = node as Text;
			if (!t.nodeValue?.includes(needle)) continue;
			if ((t.parentElement?.closest('[data-gutter]') ?? null) !== null) continue;
			return t;
		}
	}
	return null;
}

// Select `needle` inside the file's rendered diff the way a user drag would:
// setBaseAndExtent works with shadow-DOM nodes in Chromium and fires
// selectionchange, which is what drives the controller.
function selectInFile(filePath: string, needle: string): boolean {
	const t = shadowTextNode(filePath, needle);
	if (!t) return false;
	const idx = t.nodeValue!.indexOf(needle);
	const sel = window.getSelection();
	if (!sel) return false;
	sel.setBaseAndExtent(t, idx, t, idx + needle.length);
	return true;
}

function hostShadowContains(filePath: string, node: Node): boolean {
	const sec = document.querySelector(`section[data-file-path="${CSS.escape(filePath)}"]`);
	if (!sec) return false;
	for (const el of sec.querySelectorAll('*')) {
		if (el.shadowRoot?.contains(node)) return true;
	}
	return false;
}

afterEach(() => {
	window.getSelection()?.removeAllRanges();
});

describe('selection-occurrence highlighting in the real diff view', () => {
	it('paints the other occurrences of the selected text in the same file', async () => {
		render(Harness, { props: { fixtures: buildFixtures() } });

		// Re-select on every poll: Pierre renders each diff twice (plain text, then
		// again when the syntax worker returns), and the second pass destroys a
		// selection made against the first DOM, which correctly clears the
		// highlights. A user only ever selects against the settled DOM.
		await vi.waitFor(
			async () => {
				expect(selectInFile('src/mod-0/service-0.ts', 'alphaToken')).toBe(true);
				// Wait out the controller's selectionchange debounce.
				await new Promise((r) => setTimeout(r, 250));
				const ranges = highlightRanges();
				// 4 occurrences in the file (selection included).
				expect(ranges.length).toBeGreaterThanOrEqual(2);
				for (const r of ranges) {
					expect(r.toString()).toBe('alphaToken');
					expect(r.startContainer.isConnected).toBe(true);
					// Scoped to the file the selection lives in.
					expect(hostShadowContains('src/mod-0/service-0.ts', r.startContainer)).toBe(true);
				}
			},
			{ timeout: 10000 }
		);
	});

	it('clears the highlights when the selection collapses', async () => {
		render(Harness, { props: { fixtures: buildFixtures() } });
		await vi.waitFor(
			async () => {
				expect(selectInFile('src/mod-0/service-0.ts', 'alphaToken')).toBe(true);
				await new Promise((r) => setTimeout(r, 250));
				expect(highlightRanges().length).toBeGreaterThanOrEqual(2);
			},
			{ timeout: 10000 }
		);

		window.getSelection()?.removeAllRanges();
		await vi.waitFor(() => expect(highlightRanges().length).toBe(0), { timeout: 8000 });
	});

	it('paints from a REAL double-click gesture (regression: quirky selection accessors)', async () => {
		// A real CDP double-click, not setBaseAndExtent. The two produce different
		// selection states: after a real gesture the document selection reports
		// isCollapsed=true with a light-DOM range even though toString() has the
		// text, and (Chromium-version-dependent) the containing shadow root's
		// getSelection() can read rangeCount 0. Guarding on those accessors made
		// the feature dead for actual mouse selections while the programmatic
		// tests above stayed green.
		render(Harness, { props: { fixtures: buildFixtures() } });

		await vi.waitFor(
			() => expect(shadowTextNode('src/mod-0/service-0.ts', 'alphaToken')).not.toBeNull(),
			{ timeout: 8000 }
		);
		// Let Pierre's syntax-worker second render settle so the click lands on
		// the final DOM (a user can only select settled DOM anyway).
		await new Promise((r) => setTimeout(r, 700));
		const node = shadowTextNode('src/mod-0/service-0.ts', 'alphaToken')!;
		const host = (node.getRootNode() as ShadowRoot).host;

		const idx = node.nodeValue!.indexOf('alphaToken');
		const wordRange = document.createRange();
		wordRange.setStart(node, idx);
		wordRange.setEnd(node, idx + 'alphaToken'.length);
		const rect = wordRange.getBoundingClientRect();
		const hostRect = host.getBoundingClientRect();
		await page.elementLocator(host).dblClick({
			position: {
				x: rect.left + rect.width / 2 - hostRect.left,
				y: rect.top + rect.height / 2 - hostRect.top
			}
		});

		await vi.waitFor(
			() => {
				const ranges = highlightRanges();
				expect(ranges.length).toBeGreaterThanOrEqual(2);
				for (const r of ranges) expect(r.toString()).toBe('alphaToken');
			},
			{ timeout: 8000 }
		);
	});

	it('paints for a single-character selection (VSCode parity)', async () => {
		render(Harness, { props: { fixtures: buildFixtures() } });
		// '*' appears twice in file 0 (`alphaToken * 2` and `alphaToken * 3`).
		await vi.waitFor(
			async () => {
				expect(selectInFile('src/mod-0/service-0.ts', '*')).toBe(true);
				await new Promise((r) => setTimeout(r, 250));
				const ranges = highlightRanges();
				expect(ranges.length).toBeGreaterThanOrEqual(2);
				for (const r of ranges) expect(r.toString()).toBe('*');
			},
			{ timeout: 10000 }
		);
	});

	it('does not paint for a token that appears only once', async () => {
		render(Harness, { props: { fixtures: buildFixtures() } });
		// `setup0` appears exactly once in file 0, so there is no "elsewhere" to
		// show and nothing should paint.
		await vi.waitFor(() => expect(selectInFile('src/mod-0/service-0.ts', 'setup0')).toBe(true), {
			timeout: 8000
		});

		// Give the debounce plenty of time to fire, then assert nothing painted.
		await new Promise((r) => setTimeout(r, 400));
		expect(highlightRanges().length).toBe(0);
	});
});
