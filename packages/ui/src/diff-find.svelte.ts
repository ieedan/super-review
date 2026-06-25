// Ctrl/Cmd+F find controller for the diff view.
//
// Match counts come from searching the raw patch text we've already cached
// per file — no DOM scanning at all for the count. DOM walks are bounded to
// a single file section's shadow root and only happen when we actually need
// to paint a highlight (current match navigation, or a file scrolling into
// view with an active query). That avoids the previous implementation's
// freeze, which came from a global mutation observer re-walking every diff's
// shadow DOM as Pierre streamed shiki tokens.

import { tick, untrack } from 'svelte';
import { actions, app, getCachedDiff, setCachedDiff } from '@super-review/ui/store.svelte';
import { diffContextKey } from '@super-review/core/diff-context';
import type { ChangedFile, DiffContext, DiffData } from '@super-review/core/types';
import { sections, builtRanges, renderWaiters } from '@super-review/ui/diff-find-internal';
import { FindIndex } from '@super-review/ui/diff-find-index';

// The incremental match index: counts matches across every cached file's patch
// text without rebuilding from scratch on every preload completion, and maps
// `find.currentIndex` ⇄ (file, idxInFile) without materialising a flat array.
// See diff-find-index.ts for the why (it's the fix for the "falls over on big
// change sets" performance cliff). Exported under a debug name for the harness.
const matchIndex = new FindIndex();
export const _findIndex = matchIndex;

const ALL_HIGHLIGHT = 'sr-find-match';
const CURRENT_HIGHLIGHT = 'sr-find-current';

const HIGHLIGHT_CSS = `
::highlight(${ALL_HIGHLIGHT}) {
  background-color: rgba(250, 204, 21, 0.35);
  color: inherit;
}
::highlight(${CURRENT_HIGHLIGHT}) {
  background-color: rgba(249, 115, 22, 0.6);
  color: inherit;
}
`;

interface FindState {
	open: boolean;
	query: string;
	caseSensitive: boolean;
	matchCount: number;
	currentIndex: number;
	// Bumped every time the bar should claim focus (open, re-open via Cmd+F).
	focusNonce: number;
	// Bumped when an async load makes the count grow — lets the UI optionally
	// surface "still indexing" feedback. Not used yet but cheap to maintain.
	indexEpoch: number;
}

export const find = $state<FindState>({
	open: false,
	query: '',
	caseSensitive: false,
	matchCount: 0,
	currentIndex: -1,
	focusNonce: 0,
	indexEpoch: 0
});

let allHL: HighlightLike | null = null;
let currentHL: HighlightLike | null = null;
let highlightSheet: CSSStyleSheet | null = null;

let scrollContainer: HTMLElement | null = null;

// Monotonic token bumped at the start of every navigation (sync or async).
// Each async navigateTo captures the value and bails after its awaits if a
// newer navigation has superseded it. Without this, mashing Next fires a burst
// of overlapping async navigations that each clear-then-add the orange "current"
// highlight across an await boundary, leaving several stale pins painted at once
// (and sometimes none). The token makes "last navigation wins" — exactly one pin.
let navToken = 0;

// Stable identity of the current match: its file + char offset in that file's
// searchable text. `find.currentIndex` is just a flat position, which shifts
// whenever preload folds a new matching file in ahead of the current one — so we
// track the underlying (file, start) and re-derive the flat index after the
// index changes, keeping the orange pin glued to the same match instead of
// jumping. Reset when there's no current match.
let currentFile: string | null = null;
let currentStart = -1;

function recordCurrent(
	index: number,
	target: { filePath: string; idxInFile: number } | null
): void {
	find.currentIndex = index;
	if (!target) {
		currentFile = null;
		currentStart = -1;
		return;
	}
	const m = matchIndex.matchesForFile(target.filePath)[target.idxInFile];
	currentFile = target.filePath;
	currentStart = m ? m.start : -1;
}

function clearCurrent(): void {
	getHighlights()?.current.clear();
	find.currentIndex = -1;
	currentFile = null;
	currentStart = -1;
}

// ──────────────────────────────────────────────────────────────────────────
// Custom Highlight API plumbing

interface HighlightLike {
	add(range: Range): void;
	delete(range: Range): boolean;
	clear(): void;
	size: number;
}

interface HighlightCtor {
	new (...ranges: Range[]): HighlightLike;
}

function getHighlights(): { all: HighlightLike; current: HighlightLike } | null {
	if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null;
	const HC = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
	if (!HC) return null;
	if (!allHL) {
		allHL = new HC();
		currentHL = new HC();
		const highlights = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
		highlights.set(ALL_HIGHLIGHT, allHL);
		highlights.set(CURRENT_HIGHLIGHT, currentHL);
	}
	return { all: allHL, current: currentHL! };
}

function getHighlightSheet(): CSSStyleSheet | null {
	if (highlightSheet) return highlightSheet;
	if (typeof CSSStyleSheet === 'undefined') return null;
	try {
		highlightSheet = new CSSStyleSheet();
		highlightSheet.replaceSync(HIGHLIGHT_CSS);
		return highlightSheet;
	} catch {
		return null;
	}
}

// Make sure this shadow root carries the `::highlight()` style. The Custom
// Highlight API registers highlights document-globally, but they only PAINT
// inside a shadow tree whose own stylesheets define the `::highlight()` rule —
// so every diff's shadow root needs our sheet.
//
// Critically, we must NOT trust a "styled once" flag here: Pierre REPLACES the
// shadow root's `adoptedStyleSheets` on its async worker rerender (it owns that
// array for its diff theme), which silently drops our sheet. The old WeakSet
// guard then skipped re-adding it, leaving valid highlight Ranges completely
// invisible until a full re-render — the "1 of N but nothing highlighted, comes
// back when I switch tabs" bug. So we re-verify membership every call (cheap: an
// array `includes`) and re-add if it's gone.
function ensureShadowHighlightStyle(shadow: ShadowRoot): void {
	const sheet = getHighlightSheet();
	if (sheet) {
		try {
			if (!shadow.adoptedStyleSheets.includes(sheet)) {
				shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
			}
			return;
		} catch {
			// adoptedStyleSheets unsupported — fall through to the <style> element.
		}
	}
	if (!shadow.querySelector('style[data-sr-find]')) {
		const styleEl = document.createElement('style');
		styleEl.setAttribute('data-sr-find', '');
		styleEl.textContent = HIGHLIGHT_CSS;
		shadow.appendChild(styleEl);
	}
}

function getCachedDiffFor(filePath: string): DiffData | null {
	if (!app.activeRepo) return null;
	const ctx = $state.snapshot(app.diffContext) as DiffContext;
	return getCachedDiff(app.activeRepo.id, ctx, filePath) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// Index maintenance. The heavy lifting lives in the incremental FindIndex; here
// we just drive it from the store. `rebuildIndex` is the full-rescan path used
// when the query or file set changes; `addFileToIndex` is the cheap incremental
// path preload and lazy section loads use as each file's patch lands.

// Re-seed the index from the current changed-files order + query, folding in
// every file that's already in the diff cache. The per-file searchable text is
// cached inside FindIndex, so a query change only re-runs indexOf (no patch
// re-parsing), and folding in already-known files is a no-op rescan.
function rebuildIndex(): void {
	matchIndex.setOrder(app.changedFiles.map((f) => f.path));
	matchIndex.setQuery(find.query, find.caseSensitive);
	if (find.query) {
		for (const f of app.changedFiles) {
			if (matchIndex.hasFile(f.path)) continue;
			const d = getCachedDiffFor(f.path);
			if (d) matchIndex.addFile(f.path, d.patch);
		}
	}
	find.matchCount = matchIndex.matchCount;
	find.indexEpoch++;
}

// Fold a single newly-cached file into the index — O(that file), not O(all
// files). Called per preload completion / lazy section load so a burst of those
// doesn't trigger a full rescan.
function addFileToIndex(filePath: string): void {
	if (!find.open || !find.query) return;
	if (matchIndex.hasFile(filePath)) return;
	const d = getCachedDiffFor(filePath);
	if (d) matchIndex.addFile(filePath, d.patch);
}

// ──────────────────────────────────────────────────────────────────────────
// Per-file DOM walk — same flatten-and-indexOf strategy as before, but
// rooted at a single section and skipping Pierre's gutter subtree so the
// match indices align with the patch-text indices.

interface NodeSegment {
	node: Text;
	start: number;
	length: number;
}
interface SearchableTree {
	text: string;
	segments: NodeSegment[];
}

const BLOCK_LEVEL_TAGS = new Set([
	'DIV',
	'P',
	'PRE',
	'LI',
	'UL',
	'OL',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'BLOCKQUOTE',
	'SECTION',
	'ARTICLE',
	'HEADER',
	'FOOTER',
	'NAV',
	'MAIN',
	'TABLE',
	'TR',
	'TD',
	'TH',
	'THEAD',
	'TBODY',
	'TFOOT',
	'FORM',
	'HR',
	'ADDRESS',
	'FIELDSET',
	'FIGURE',
	'DETAILS',
	'SUMMARY',
	'DL',
	'DT',
	'DD'
]);

// Pierre's gutter wrapper carries `data-gutter=""`. Anything below that point
// is line-number / metadata content the user doesn't want searched (otherwise
// a query like "12" would light up every line number). The `data-gutter-buffer`
// elements are spacer cells with the same caveat.
function isExcludedFromSearch(el: Element): boolean {
	return (
		el.hasAttribute('data-gutter') ||
		el.hasAttribute('data-gutter-buffer') ||
		el.hasAttribute('data-gutter-utility-slot') ||
		// The file header lives inside our own `<header>` element; skip it.
		el.tagName === 'HEADER'
	);
}

function buildSearchableTreeForSection(root: Node): SearchableTree {
	const segments: NodeSegment[] = [];
	let text = '';

	const appendSep = (): void => {
		if (text.length > 0 && !text.endsWith('\n')) text += '\n';
	};

	const visit = (node: Node): void => {
		if (node.nodeType === Node.TEXT_NODE) {
			const t = node as Text;
			const v = t.nodeValue ?? '';
			if (v.length > 0) {
				segments.push({ node: t, start: text.length, length: v.length });
				text += v;
			}
			return;
		}

		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			if (isExcludedFromSearch(el)) return;
			const isBlock = BLOCK_LEVEL_TAGS.has(el.tagName);
			if (isBlock) appendSep();
			if (el.shadowRoot) {
				ensureShadowHighlightStyle(el.shadowRoot);
				visit(el.shadowRoot);
			}
			const children = el.childNodes;
			for (let i = 0; i < children.length; i++) visit(children[i]);
			if (isBlock) appendSep();
			return;
		}

		// DocumentFragment (incl. ShadowRoot) and other containers.
		const children = node.childNodes;
		for (let i = 0; i < children.length; i++) visit(children[i]);
	};

	visit(root);
	return { text, segments };
}

function segmentIndexAt(segments: NodeSegment[], pos: number): number {
	let lo = 0;
	let hi = segments.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		const seg = segments[mid];
		if (pos < seg.start) hi = mid - 1;
		else if (pos >= seg.start + seg.length) lo = mid + 1;
		else return mid;
	}
	return -1;
}

function rangeFor(segments: NodeSegment[], start: number, end: number): Range | null {
	if (end <= start) return null;
	const startIdx = segmentIndexAt(segments, start);
	const endIdx = segmentIndexAt(segments, end - 1);
	if (startIdx < 0 || endIdx < 0) return null;
	const startSeg = segments[startIdx];
	const endSeg = segments[endIdx];
	const r = document.createRange();
	try {
		r.setStart(startSeg.node, start - startSeg.start);
		r.setEnd(endSeg.node, end - endSeg.start);
		return r;
	} catch {
		return null;
	}
}

// Walk one file section's shadow DOM, search for the query, return one Range
// per match. The Nth Range here corresponds to the Nth match the FindIndex
// counted for this file (both scan the file's code text). See diff-find-index.ts
// for the caveat that git-patch context and Pierre's rendered context can differ.
function buildRangesForSection(filePath: string): Range[] {
	const reg = sections.get(filePath);
	if (!reg || !find.query) return [];
	const tree = buildSearchableTreeForSection(reg.sectionEl);
	const needle = find.caseSensitive ? find.query : find.query.toLowerCase();
	const hay = find.caseSensitive ? tree.text : tree.text.toLowerCase();
	const ranges: Range[] = [];
	let idx = 0;
	while (true) {
		const f = hay.indexOf(needle, idx);
		if (f < 0) break;
		const r = rangeFor(tree.segments, f, f + needle.length);
		if (r) ranges.push(r);
		idx = f + Math.max(needle.length, 1);
	}
	return ranges;
}

// ──────────────────────────────────────────────────────────────────────────
// Highlight bookkeeping

function clearAllHighlights(): void {
	const hl = getHighlights();
	if (!hl) return;
	hl.all.clear();
	hl.current.clear();
	builtRanges.clear();
}

function dropFileRanges(filePath: string): void {
	const hl = getHighlights();
	if (!hl) return;
	const built = builtRanges.get(filePath);
	if (!built) return;
	for (const r of built.ranges) hl.all.delete(r);
	builtRanges.delete(filePath);
}

// Signature of the current search, so a cached range set built for a different
// query/case is treated as stale even when the render epoch is unchanged.
function querySig(): string {
	return `${find.caseSensitive ? 's' : 'i'} ${find.query}`;
}

// Build (or refresh) yellow highlights for one file. No-op if the file's
// existing build matches the current render epoch AND query. We gate on
// `renderEpoch > 0` (the section has rendered DOM to walk), NOT on the mirrored
// `inView` flag: that mirror can lag or desync from the real visibility, and
// when it does, gating on it means find walks nothing and paints zero
// highlights even though the diff is right there on screen — the "1 of N but
// nothing highlighted" report. If there's DOM, we can highlight it.
function refreshFileHighlights(filePath: string): void {
	const reg = sections.get(filePath);
	if (!reg) return;
	const hl = getHighlights();
	if (!hl) return;
	if (!find.open || !find.query || reg.renderEpoch === 0) {
		dropFileRanges(filePath);
		return;
	}
	const sig = querySig();
	const existing = builtRanges.get(filePath);
	if (existing && existing.epoch === reg.renderEpoch && existing.querySig === sig) return;
	// Stale build — remove its ranges before re-walking.
	if (existing) {
		for (const r of existing.ranges) hl.all.delete(r);
	}
	const ranges = buildRangesForSection(filePath);
	builtRanges.set(filePath, { epoch: reg.renderEpoch, querySig: sig, ranges });
	for (const r of ranges) hl.all.add(r);
}

function refreshAllInViewHighlights(): void {
	for (const [path, reg] of sections) {
		if (reg.renderEpoch > 0) refreshFileHighlights(path);
		else dropFileRanges(path);
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Navigation — scrolls the target file into view, expands it if collapsed,
// waits for its diff to render, then sets the orange current-match highlight.

// Resolvers waiting for a file's section to be MOUNTED (registered). The diff
// view only mounts the first ~INITIAL_RENDER sections and grows the window as
// the user scrolls — so on a big change set most matches live in files whose
// section doesn't exist yet. Navigation asks the view to reveal the file (which
// grows the window), then parks here until registerFindSection mounts it.
// Plain Map: non-reactive imperative bookkeeping, not UI state.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const sectionWaiters = new Map<string, Array<() => void>>();

function waitForSectionRegistered(filePath: string): Promise<void> {
	if (sections.has(filePath)) return Promise.resolve();
	return new Promise((resolve) => {
		const list = sectionWaiters.get(filePath) ?? [];
		list.push(resolve);
		sectionWaiters.set(filePath, list);
		// Safety net so navigation can't hang if the file never mounts.
		window.setTimeout(() => {
			const cur = sectionWaiters.get(filePath);
			if (!cur) return;
			const i = cur.indexOf(resolve);
			if (i >= 0) cur.splice(i, 1);
			resolve();
		}, 2000);
	});
}

function flushSectionWaiters(filePath: string): void {
	const list = sectionWaiters.get(filePath);
	if (!list || list.length === 0) return;
	sectionWaiters.delete(filePath);
	for (const fn of list) {
		try {
			fn();
		} catch {
			// ignore
		}
	}
}

function waitForRender(filePath: string): Promise<void> {
	const reg = sections.get(filePath);
	// Already rendered — the section reported a non-zero renderEpoch. We
	// deliberately don't also require `inView` here: when navigation renders a
	// scrolled-to file synchronously (forceRenderForFind), the DOM exists
	// immediately but the IntersectionObserver hasn't flipped `inView` yet, so
	// gating on it would park this until the 1500ms safety timeout — adding up to
	// 1.5s of lag (and a "won't apply" window) to every jump to an off-screen
	// match. renderEpoch alone answers the only question that matters here: is
	// the DOM built?
	if (reg && reg.renderEpoch > 0) return Promise.resolve();
	return new Promise((resolve) => {
		const list = renderWaiters.get(filePath) ?? [];
		list.push(resolve);
		renderWaiters.set(filePath, list);
		// Safety net: time out so navigation never hangs forever if the file
		// never reports a render (e.g. binary / truncated).
		window.setTimeout(() => {
			const cur = renderWaiters.get(filePath);
			if (!cur) return;
			const idx = cur.indexOf(resolve);
			if (idx >= 0) cur.splice(idx, 1);
			resolve();
		}, 1500);
	});
}

function flushRenderWaiters(filePath: string): void {
	const list = renderWaiters.get(filePath);
	if (!list || list.length === 0) return;
	renderWaiters.delete(filePath);
	for (const fn of list) {
		try {
			fn();
		} catch {
			// ignore
		}
	}
}

function elementForScroll(node: Node): Element | null {
	if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
	const parent = node.parentElement;
	if (parent) return parent;
	const root = node.getRootNode();
	if (root instanceof ShadowRoot) return root.host as Element;
	return null;
}

// Resolve the DOM Range for a file's Nth match, (re)walking the section if its
// cached ranges are stale. Returns null when the file isn't rendered/in view.
//
// The match COUNT comes from scanning the cached git patch, but the Ranges come
// from walking Pierre's rendered DOM — and the two don't always contain the same
// number of hits (Pierre renders a wider context window than git's patch, and
// split view duplicates shared context lines). So `idxInFile` can land past the
// DOM range list; we clamp to the last real range rather than returning null, so
// the pin always paints *something* on the right file instead of vanishing.
function rangeForMatch(filePath: string, idxInFile: number): Range | null {
	const reg = sections.get(filePath);
	if (!reg || reg.renderEpoch === 0) return null;
	refreshFileHighlights(filePath);
	const built = builtRanges.get(filePath);
	if (!built || built.ranges.length === 0) return null;
	const i = Math.min(idxInFile, built.ranges.length - 1);
	return built.ranges[i] ?? null;
}

// Paint the orange "current" highlight for the match at `index` without
// touching scroll. Used while the user is typing — yellow highlights update
// across in-view files, and the current pin moves silently. If the target
// file isn't rendered (off-screen or never opened), there's no Range to paint
// *yet*: we record the index but DON'T clear the existing pin, so a background
// index recompute (e.g. as preload folds in more files) can't wipe the pin the
// user is looking at. nextMatch/prevMatch fill it in on real navigation.
function paintCurrentNoScroll(index: number): void {
	const hl = getHighlights();
	if (!hl) return;
	const target = matchIndex.matchAt(index);
	if (!target) {
		clearCurrent();
		return;
	}
	recordCurrent(index, target);
	const range = rangeForMatch(target.filePath, target.idxInFile);
	if (!range) return; // keep whatever pin is already painted
	hl.current.clear();
	hl.current.add(range);
}

// Try to navigate to `index` synchronously. Returns true if it handled
// everything (file already rendered, ranges already built — just a Range
// swap). Returns false if the slow async path is needed (file collapsed,
// off-screen, ranges missing). Going synchronous matters because pressing
// Enter to step through matches in the same file would otherwise flash the
// orange highlight off across the `await` microtask boundary.
function tryNavigateSync(index: number): boolean {
	const hl = getHighlights();
	if (!hl) return false;
	const target = matchIndex.matchAt(index);
	if (!target) return false;
	if (app.collapsedFiles.has(target.filePath)) return false;
	// rangeForMatch (re)walks the section if the cached ranges are stale and
	// clamps an out-of-range patch index to a real DOM range, so the same code
	// path handles "ranges already built" and "ranges need a fresh walk".
	const range = rangeForMatch(target.filePath, target.idxInFile);
	if (!range) return false;
	recordCurrent(index, target);
	hl.current.clear();
	hl.current.add(range);
	if (!isRangeInViewport(range)) {
		const el = elementForScroll(range.startContainer);
		if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
	}
	return true;
}

// Full navigation: expand the file if needed, scroll its section into view,
// wait for Pierre to render, paint orange, then scroll the specific range to
// the viewport center. Used by Enter / next / prev when the sync path can't
// satisfy the nav (off-screen file, collapsed file, never-rendered file).
async function navigateTo(index: number): Promise<void> {
	// Claim this navigation. Any async navigation still in flight from a previous
	// call is now stale and must not paint when it resumes. Bumping before the
	// sync attempt means a fast same-file Enter also invalidates a slow pending
	// cross-file nav.
	const myToken = ++navToken;

	if (tryNavigateSync(index)) return;

	const hl = getHighlights();
	if (!hl) return;
	const target = matchIndex.matchAt(index);
	if (!target) {
		clearCurrent();
		return;
	}
	recordCurrent(index, target);

	if (!sections.has(target.filePath)) {
		// The target file's section isn't mounted — it's past the diff view's
		// incremental render window (only the first ~80 files mount up front on a
		// big change set). Ask the view to reveal it, which grows the window,
		// expands the file if collapsed, and scrolls to it; the section then mounts
		// and registers, waking us. Without this, find silently does nothing for any
		// match in a file beyond the window — the "breaks down on a big branch" bug.
		actions.scrollToFile(target.filePath);
		await waitForSectionRegistered(target.filePath);
		if (myToken !== navToken) return;
		// Give the freshly-mounted section a tick to flush its `hidden`/host DOM
		// before we try to render into it synchronously.
		await tick();
		if (myToken !== navToken) return;
	} else if (app.collapsedFiles.has(target.filePath)) {
		void actions.toggleFileCollapsed(target.filePath, false);
		// Let Svelte flush the `hidden={!expanded}` wrapper to the DOM before we
		// ask the section to render: forceRenderForFind bails on a still-hidden
		// host (it would measure 0×0), so without this the collapsed file would
		// fall back to the slow scheduler path and the highlight would lag.
		await tick();
		if (myToken !== navToken) return;
	}

	const reg = sections.get(target.filePath);
	let rendered = false;
	if (reg) {
		reg.sectionEl.scrollIntoView({ block: 'start', behavior: 'auto' });
		// We just scrolled this file to the top — it IS the file in view now. The
		// IntersectionObserver will confirm shortly, but optimistically mark it so
		// rangeForMatch (which gates range-building on inView) can paint without
		// waiting a poll cycle. Stale if the user immediately scrolls away, but the
		// observer reclaims authority the moment it fires.
		reg.inView = true;
		// Skip the FRAME_BUDGET_MS render scheduler queue for the navigation
		// target. Without this, the target's render sits behind every other
		// file the scrollIntoView swept into the IntersectionObserver margin,
		// and the highlight can take seconds to appear on large diff sets.
		// renderIfNeeded returns true when the DOM is ready synchronously (already
		// rendered, or just rendered from cache) — then there's nothing to wait for.
		rendered = reg.renderIfNeeded?.() ?? false;
	}

	if (!rendered) await waitForRender(target.filePath);
	// Superseded by a newer navigation while we waited — don't paint a stale pin.
	if (myToken !== navToken) return;

	const range = rangeForMatch(target.filePath, target.idxInFile);
	if (!range) return;

	// Clear here (not before the await) so a superseding nav's pin isn't wiped by
	// this stale one, and so the old pin stays put until the new range is ready.
	hl.current.clear();
	hl.current.add(range);
	if (!isRangeInViewport(range)) {
		const el = elementForScroll(range.startContainer);
		if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
	}
}

// Is a Range's first line already visible inside the scroll container?
// Used to avoid re-centering a match the user is already looking at.
function isRangeInViewport(range: Range): boolean {
	if (!scrollContainer) return false;
	let rect: DOMRect;
	try {
		rect = range.getBoundingClientRect();
	} catch {
		return false;
	}
	if (rect.width === 0 && rect.height === 0) return false;
	const containerRect = scrollContainer.getBoundingClientRect();
	return rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
}

// ──────────────────────────────────────────────────────────────────────────
// Public API

export function setFindScrollContainer(el: HTMLElement | null): void {
	scrollContainer = el;
}

export function registerFindSection(
	filePath: string,
	sectionEl: HTMLElement,
	hooks?: { renderIfNeeded?: () => boolean }
): () => void {
	sections.set(filePath, {
		sectionEl,
		inView: false,
		renderEpoch: 0,
		renderIfNeeded: hooks?.renderIfNeeded
	});
	// Wake any navigation parked waiting for this section to mount (it was beyond
	// the diff view's incremental render window until just now).
	flushSectionWaiters(filePath);
	// If find is already active, the file may have matches to fold in.
	if (find.open && find.query) {
		addFileToIndex(filePath);
		queueRefresh();
	}
	return () => {
		dropFileRanges(filePath);
		sections.delete(filePath);
		flushRenderWaiters(filePath);
	};
}

export function notifySectionState(
	filePath: string,
	patch: { inView?: boolean; bumpRenderEpoch?: boolean; dataLoaded?: boolean }
): void {
	const reg = sections.get(filePath);
	if (!reg) return;
	// untrack: this is imperative bookkeeping that reads reactive find state
	// (find.open/query/currentIndex). It's called from component $effects (the
	// in-view mirror, the render scheduler, clearLoadedDiff). Without untrack
	// those effects would TRACK find state and re-run on every keystroke — and the
	// render/registration effects re-running resets renderEpoch, which silently
	// breaks highlighting. The reads here must never become caller dependencies.
	untrack(() => {
		let changed = false;
		if (patch.inView != null && patch.inView !== reg.inView) {
			reg.inView = patch.inView;
			changed = true;
		}
		if (patch.bumpRenderEpoch) {
			reg.renderEpoch++;
			changed = true;
			flushRenderWaiters(filePath);
		}
		if (patch.dataLoaded) {
			// New cached diff data for this file — fold just this file into the index
			// (cheap, incremental) and schedule a UI refresh.
			addFileToIndex(filePath);
			queueRefresh();
		}
		if (!changed) return;
		if (!find.open) return;
		refreshFileHighlights(filePath);
		// If the orange "current" match lives in this file and its DOM was just
		// rebuilt, repaint it. This is the fix for "find says 1 of N but nothing is
		// highlighted until I switch tabs": Pierre renders a diff twice — plain
		// text, then again when the syntax-highlight worker returns, and that second
		// pass REPLACES the shadow-DOM text nodes our painted Range pointed at, so
		// the pin (and the yellow ranges) silently dangle. DiffFileSection routes
		// Pierre's onPostRender through here (bumpRenderEpoch), so we re-walk and
		// repaint against the fresh DOM the moment the worker pass lands.
		if (patch.bumpRenderEpoch && currentFile === filePath && find.currentIndex >= 0) {
			paintCurrentNoScroll(find.currentIndex);
		}
	});
}

// Sync the visible UI to the current index state: update the count, repaint the
// in-view yellow highlights, and re-anchor the orange pin. This is cheap — the
// index itself was already updated incrementally by addFileToIndex; here we just
// read its totals and re-derive the current flat index from the stable
// (file, start) anchor, so the pin stays on the same match as preload folds new
// matching files in ahead of it.
function runRefresh(): void {
	if (!find.open) return;
	find.matchCount = matchIndex.matchCount;
	find.indexEpoch++;
	refreshAllInViewHighlights();
	if (find.matchCount === 0) {
		clearCurrent();
		return;
	}
	let preservedIdx = -1;
	if (currentFile && currentStart >= 0) {
		const fm = matchIndex.matchesForFile(currentFile);
		const inFile = fm.findIndex((m) => m.start === currentStart);
		if (inFile >= 0) preservedIdx = matchIndex.flatIndexOf(currentFile, inFile);
	}
	if (preservedIdx < 0) {
		preservedIdx = find.currentIndex >= 0 ? Math.min(find.currentIndex, find.matchCount - 1) : 0;
	}
	paintCurrentNoScroll(preservedIdx);
}

// Throttle the UI refresh to once per 100ms with a guaranteed trailing run: a
// call arriving while a cycle is in flight sets `dirty`, and the cycle re-arms
// until a window passes with nothing new (a plain "drop while pending" debounce
// loses the tail — the last preloaded files' counts never land). The index
// updates that back this are now O(1-per-file) incremental, so the only real
// per-cycle cost is the in-view DOM highlight refresh, bounded by visible files.
let refreshTimer: number | null = null;
let refreshDirty = false;
function queueRefresh(): void {
	refreshDirty = true;
	if (refreshTimer != null) return;
	const tick = (): void => {
		if (!refreshDirty) {
			refreshTimer = null;
			return;
		}
		refreshDirty = false;
		runRefresh();
		refreshTimer = window.setTimeout(tick, 100);
	};
	refreshTimer = window.setTimeout(tick, 100);
}

// In-progress preload session — incremented each time openFind kicks one off
// so stale fetches from a previous session bail out cleanly.
let preloadSession = 0;

// Fetch patches for any changed file that isn't in the diff cache yet, so
// the match count covers ALL files, not just the ones the user has scrolled
// past. Throttled concurrency keeps the IPC queue manageable on large diffs.
async function preloadAllPatches(): Promise<void> {
	if (!app.activeRepo) return;
	const session = ++preloadSession;
	const repo = app.activeRepo;
	const ctx = $state.snapshot(app.diffContext) as DiffContext;
	const ctxKey = diffContextKey(ctx);

	const queue: ChangedFile[] = [];
	for (const f of app.changedFiles) {
		if (f.isBinary) continue;
		if (getCachedDiff(repo.id, ctx, f.path)) continue;
		queue.push(f);
	}
	if (queue.length === 0) return;

	const CONCURRENCY = 4;
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (cursor < queue.length) {
			if (session !== preloadSession) return; // superseded — bail
			if (!find.open) return; // user closed find
			const file = queue[cursor++];
			try {
				const d = await window.api.git.getDiff(repo.id, file.path, ctx);
				if (session !== preloadSession) return;
				if (!app.activeRepo || app.activeRepo.id !== repo.id) return;
				const curKey = diffContextKey($state.snapshot(app.diffContext) as DiffContext);
				if (curKey !== ctxKey) return;
				setCachedDiff(repo.id, ctx, file.path, d);
				// Fold just this file into the index (O(file), not a full rescan),
				// then schedule a throttled UI refresh — so a burst of concurrent
				// completions stays cheap even with thousands of changed files.
				addFileToIndex(file.path);
				queueRefresh();
			} catch {
				// Skip files that fail to load — preload is best-effort.
			}
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

// Pull the current text selection so Cmd/Ctrl+F can seed the find bar with it,
// the way browsers and VSCode do. The diff content lives inside per-file shadow
// roots, where the document-level selection retargets to the shadow host and
// `window.getSelection().toString()` comes back empty — so when the top-level
// selection is empty we fall back to Chromium's non-standard
// `ShadowRoot.getSelection()` on the registered sections' shadow roots.
function readSelectionText(): string {
	const top = window.getSelection()?.toString() ?? '';
	const raw = top.trim() ? top : selectionTextFromSections();
	const trimmed = raw.trim();
	// Only seed single-line selections: a multi-line selection won't match the
	// patch text anyway (block separators break matches across lines), and
	// clobbering the box with it would be more surprising than useful.
	if (!trimmed || /[\r\n]/.test(trimmed)) return '';
	return trimmed;
}

type ShadowRootWithSelection = ShadowRoot & { getSelection?: () => Selection | null };

function selectionTextFromSections(): string {
	for (const reg of sections.values()) {
		const text = shadowSelectionText(reg.sectionEl);
		if (text) return text;
	}
	return '';
}

function shadowSelectionText(el: Element): string {
	const root = el.shadowRoot as ShadowRootWithSelection | null;
	if (root && typeof root.getSelection === 'function') {
		const text = root.getSelection()?.toString() ?? '';
		if (text.trim()) return text;
	}
	const kids = el.children;
	for (let i = 0; i < kids.length; i++) {
		const text = shadowSelectionText(kids[i]);
		if (text) return text;
	}
	return '';
}

export function openFind(): void {
	const selection = readSelectionText();
	find.open = true;
	find.focusNonce++;
	// Seed the query with the current selection, like browsers / VSCode. The
	// FindBar input reflects find.query and selects it on open, so the next
	// keystroke still replaces it.
	if (selection && selection !== find.query) find.query = selection;
	// Always kick off a preload so unmounted files contribute to the count.
	// Safe to call repeatedly — cached files are skipped, in-flight session
	// is superseded by the new one.
	void preloadAllPatches();
	if (find.query) {
		rebuildIndex();
		refreshAllInViewHighlights();
		// Bar re-opened with a prefilled query — surface the first match the
		// same way a fresh search would.
		if (find.matchCount > 0 && find.currentIndex < 0) void navigateTo(0);
	}
}

export function closeFind(): void {
	find.open = false;
	find.matchCount = 0;
	find.currentIndex = -1;
	currentFile = null;
	currentStart = -1;
	matchIndex.clear();
	clearAllHighlights();
	// Cancel a pending UI refresh so it can't fire against the cleared state.
	if (refreshTimer != null) {
		window.clearTimeout(refreshTimer);
		refreshTimer = null;
	}
	refreshDirty = false;
	// Bump the preload session so any in-flight workers stop the next time
	// they check.
	preloadSession++;
	// Don't drop sections — they're still mounted; just stop highlighting.
}

// After a query/case-sensitivity change, settle on a current match and
// navigate (scroll) to it iff the user's previous anchor is gone. This mirrors
// what browsers do: typing scrolls to the first match unless your current match
// (same file + same char offset) is still a match for the new query.
function settleAfterQueryChange(prevFile: string | null, prevStart: number): void {
	if (find.matchCount === 0) {
		clearCurrent();
		return;
	}
	if (prevFile && prevStart >= 0) {
		const fm = matchIndex.matchesForFile(prevFile);
		const inFile = fm.findIndex((m) => m.start === prevStart);
		if (inFile >= 0) {
			const flat = matchIndex.flatIndexOf(prevFile, inFile);
			if (flat >= 0) {
				paintCurrentNoScroll(flat);
				return;
			}
		}
	}
	// No equivalent match — scroll to #1 so the user can see where the new
	// query landed. navigateTo's sync fast path keeps this snappy when the
	// first match is already in a rendered visible file.
	void navigateTo(0);
}

let queryDebounce: number | null = null;
export function setQuery(q: string): void {
	if (find.query === q) return;
	find.query = q;
	if (!find.open) return;
	if (queryDebounce != null) window.clearTimeout(queryDebounce);
	// Tiny debounce — the work itself is fast for cached patches, but coalescing
	// back-to-back keystrokes keeps typing snappy when many files are loaded.
	queryDebounce = window.setTimeout(() => {
		queryDebounce = null;
		if (!q) {
			matchIndex.setQuery('', find.caseSensitive);
			find.matchCount = 0;
			currentFile = null;
			currentStart = -1;
			find.currentIndex = -1;
			clearAllHighlights();
			return;
		}
		const prevFile = currentFile;
		const prevStart = currentStart;
		rebuildIndex();
		refreshAllInViewHighlights();
		settleAfterQueryChange(prevFile, prevStart);
	}, 80);
}

export function toggleCaseSensitive(): void {
	find.caseSensitive = !find.caseSensitive;
	if (!find.open || !find.query) return;
	const prevFile = currentFile;
	const prevStart = currentStart;
	rebuildIndex();
	refreshAllInViewHighlights();
	settleAfterQueryChange(prevFile, prevStart);
}

export function nextMatch(): void {
	const count = matchIndex.matchCount;
	if (count === 0) return;
	const cur = find.currentIndex;
	const next = cur < 0 ? 0 : (cur + 1) % count;
	void navigateTo(next);
}

export function prevMatch(): void {
	const count = matchIndex.matchCount;
	if (count === 0) return;
	const cur = find.currentIndex;
	const prev = cur < 0 ? count - 1 : (cur - 1 + count) % count;
	void navigateTo(prev);
}

// Used by old call site in DiffView — kept as an alias so we don't have to
// touch every importer. The new module relies on per-section registration,
// not a single root pointer, so this only stores the scroll container ref.
export function setFindRoot(el: HTMLElement | null): void {
	setFindScrollContainer(el);
}
