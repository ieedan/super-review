// Shared DOM plumbing for searching a diff file section's rendered (shadow)
// DOM: flatten the tree into searchable text, map text offsets back to DOM
// Ranges, and keep every shadow root carrying the `::highlight()` styles.
//
// Extracted from diff-find.svelte.ts so the Ctrl/Cmd+F find controller and the
// selection-occurrence highlighter (diff-selection.ts) share one walker and one
// stylesheet instead of drifting apart.

// Highlight names registered in the CSS Custom Highlight registry. All the
// rules live in ONE stylesheet below because a shadow root only paints
// highlights whose `::highlight()` rule appears in its own styles; sharing the
// sheet means adopting it once covers every feature.
export const FIND_ALL_HIGHLIGHT = 'sr-find-match';
export const FIND_CURRENT_HIGHLIGHT = 'sr-find-current';
export const SELECTION_HIGHLIGHT = 'sr-selection-occurrence';

const HIGHLIGHT_CSS = `
::highlight(${FIND_ALL_HIGHLIGHT}) {
  background-color: rgba(250, 204, 21, 0.35);
  color: inherit;
}
::highlight(${FIND_CURRENT_HIGHLIGHT}) {
  background-color: rgba(249, 115, 22, 0.6);
  color: inherit;
}
::highlight(${SELECTION_HIGHLIGHT}) {
  background-color: rgba(148, 163, 184, 0.32);
  color: inherit;
}
`;

// ──────────────────────────────────────────────────────────────────────────
// Custom Highlight API plumbing

export interface HighlightLike {
	add(range: Range): void;
	delete(range: Range): boolean;
	clear(): void;
	size: number;
	priority?: number;
}

interface HighlightCtor {
	new (...ranges: Range[]): HighlightLike;
}

// Create (or return the existing) named highlight in the document registry.
// Returns null where the Custom Highlight API isn't available. `priority`
// resolves overlaps: the find pin (highest) must win over the yellow find
// matches, which win over selection occurrences.
const registered = new Map<string, HighlightLike>();
export function registerHighlight(name: string, priority: number): HighlightLike | null {
	const existing = registered.get(name);
	if (existing) return existing;
	if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null;
	const HC = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
	if (!HC) return null;
	const hl = new HC();
	try {
		hl.priority = priority;
	} catch {
		// priority unsupported; registration order still keeps a sane stacking.
	}
	const highlights = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
	highlights.set(name, hl);
	registered.set(name, hl);
	return hl;
}

let highlightSheet: CSSStyleSheet | null = null;

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

// Make sure this shadow root carries the `::highlight()` styles. The Custom
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
export function ensureShadowHighlightStyle(shadow: ShadowRoot): void {
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

// ──────────────────────────────────────────────────────────────────────────
// Per-file DOM walk: flatten a section's shadow DOM into one searchable
// string plus the text-node segments backing it, so a text offset found with
// indexOf maps straight back to a DOM Range. Skips Pierre's gutter subtree so
// the flattened text aligns with the patch/code text.

export interface NodeSegment {
	node: Text;
	start: number;
	length: number;
}
export interface SearchableTree {
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

export function buildSearchableTreeForSection(root: Node): SearchableTree {
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

export function rangeFor(segments: NodeSegment[], start: number, end: number): Range | null {
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
