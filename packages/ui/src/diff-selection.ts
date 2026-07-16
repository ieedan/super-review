// VSCode-style selection-occurrence highlighting for the diff view: select
// some text in a rendered diff and every other occurrence of that exact text
// in the SAME file lights up, so you can follow an identifier through the file
// without opening find.
//
// Driven by the document `selectionchange` event (debounced, since drag-selecting
// fires it continuously). The diff content lives inside per-file shadow roots,
// where reading the selection is quirk-ridden (see selectionNode below): we
// resolve the text and a node inside the selection through a chain of
// fallbacks (Selection.getComposedRanges, then the non-standard
// ShadowRoot.getSelection accessors), and map the node back to its owning file
// section via the shadow host chain. The occurrence scan reuses the find
// controller's section walker, and paints through the CSS Custom Highlight API
// with a subtler color (and lower priority) than the find highlights so both
// can be active at once.

import { sections } from '@super-review/ui/diff-find-internal';
import {
	SELECTION_HIGHLIGHT,
	registerHighlight,
	buildSearchableTreeForSection,
	rangeFor,
	type HighlightLike
} from '@super-review/ui/diff-section-search';

// Even a single selected character highlights its occurrences (VSCode parity);
// longer than MAX_LENGTH is a "select a whole block" gesture, not a "where
// else is this used" question. Single-line only: a multi-line selection can't
// recur meaningfully and the block separators in the flattened text wouldn't
// match it anyway.
const MIN_LENGTH = 1;
const MAX_LENGTH = 200;
// Safety valve for pathological selections (e.g. a space-padded token that
// matches thousands of times in a giant file).
const MAX_MATCHES = 2000;
const DEBOUNCE_MS = 120;

// The occurrence currently painted: which file's section, and the exact text.
// Kept so a Pierre re-render of that section (which replaces the text nodes our
// Ranges point at) can trigger a repaint against the fresh DOM.
let activeFile: string | null = null;
let activeNeedle = '';

function getHighlight(): HighlightLike | null {
	// Below the find highlights (priority 1 and 2) so the orange pin and yellow
	// matches always win an overlap.
	return registerHighlight(SELECTION_HIGHLIGHT, 0);
}

type ShadowRootWithSelection = ShadowRoot & { getSelection?: () => Selection | null };
type SelectionWithComposed = Selection & {
	getComposedRanges?: (options?: { shadowRoots?: ShadowRoot[] }) => StaticRange[];
};

// The shadow roots of every rendered section, tagged with their owning file.
// Only the section's LIGHT DOM is scanned (header + Pierre's host wrapper, a
// handful of elements); the heavy diff DOM lives inside the shadow root, which
// querySelectorAll doesn't pierce.
function renderedSectionRoots(): ShadowRoot[] {
	const out: ShadowRoot[] = [];
	for (const reg of sections.values()) {
		if (reg.renderEpoch === 0) continue;
		for (const el of reg.sectionEl.querySelectorAll('*')) {
			if (el.shadowRoot) out.push(el.shadowRoot);
		}
	}
	return out;
}

// Map a node (possibly deep inside nested shadow roots) to the registered file
// section that contains it, by climbing the shadow host chain up to the
// document tree and testing containment against each section element.
function owningSection(node: Node): string | null {
	let n: Node | null = node;
	while (n) {
		const root = n.getRootNode();
		if (root instanceof ShadowRoot) {
			n = root.host;
			continue;
		}
		for (const [path, reg] of sections) {
			if (reg.sectionEl.contains(n)) return path;
		}
		return null;
	}
	return null;
}

// Find a node inside the current selection, for attributing it to a file.
//
// Deliberately NOT guarded on `isCollapsed`/`rangeCount`: for selections inside
// shadow roots those accessors are a minefield of version-dependent Chromium
// quirks. Observed in the wild, all for the SAME real drag/double-click:
//   - document selection: toString() returns the text, but isCollapsed reads
//     true and the range is retargeted to a light-DOM wrapper;
//   - the containing root's non-standard getSelection(): sometimes a full
//     range, sometimes rangeCount 0 with only anchorNode populated, sometimes
//     neither (only toString works).
// So: prefer the standards path (getComposedRanges, which returns the true
// endpoints), then fall back through the per-root accessors, trusting whichever
// signal actually points into a shadow root.
function selectionNode(sel: Selection, roots: ShadowRoot[]): Node | null {
	// 1) getComposedRanges: the standards path.
	const composed = (sel as SelectionWithComposed).getComposedRanges;
	if (typeof composed === 'function') {
		try {
			for (const r of composed.call(sel, { shadowRoots: roots })) {
				if (!r.collapsed) return r.startContainer;
			}
		} catch {
			// fall through to the per-root accessors
		}
	}
	// 2) Per-root selection: only the CONTAINING root exposes a range or anchor
	// (non-containing roots read rangeCount 0 / anchorNode null), so verifying
	// the node's root prevents misattributing the file.
	for (const root of roots) {
		const ss = (root as ShadowRootWithSelection).getSelection?.();
		if (!ss) continue;
		if (ss.rangeCount > 0) {
			const n = ss.getRangeAt(0).startContainer;
			if (n.getRootNode() === root) return n;
		}
		const a = ss.anchorNode;
		if (a && a.getRootNode() === root) return a;
	}
	// 3) A plain light-DOM selection (isCollapsed is trustworthy there).
	if (sel.rangeCount > 0 && !sel.isCollapsed) return sel.getRangeAt(0).startContainer;
	return null;
}

interface SectionSelection {
	filePath: string;
	text: string;
}

function readSectionSelection(): SectionSelection | null {
	const sel = window.getSelection();
	if (!sel) return null;
	const roots = renderedSectionRoots();

	// The selected text. Modern Chromium returns it from the document selection
	// even when the selection lives inside a shadow root; older Chromium returns
	// '' there but exposes it through ShadowRoot.getSelection(). Note the
	// per-root toString() is NOT root-scoped (every root reports the same text),
	// so it can supply the text but never the owning file.
	let text = sel.toString();
	if (!text.trim()) {
		for (const root of roots) {
			const t = (root as ShadowRootWithSelection).getSelection?.()?.toString() ?? '';
			if (t.trim()) {
				text = t;
				break;
			}
		}
	}
	if (!text.trim()) return null;

	// Attribute the selection to a file. If we can't resolve a node (or it lives
	// outside every section: sidebar, comments, find bar), don't paint anything;
	// misattributing the file would be worse than skipping.
	const node = selectionNode(sel, roots);
	if (!node) return null;
	const filePath = owningSection(node);
	return filePath ? { filePath, text } : null;
}

// (Re)walk the active file's section and paint every occurrence of the active
// needle. Exact, case-sensitive match: selecting `Widget` shouldn't light up
// `widget`, same as VSCode's selection highlight.
function paint(): void {
	const hl = getHighlight();
	if (!hl) return;
	hl.clear();
	if (!activeFile || !activeNeedle) return;
	const reg = sections.get(activeFile);
	if (!reg || reg.renderEpoch === 0) return;
	const tree = buildSearchableTreeForSection(reg.sectionEl);
	const ranges: Range[] = [];
	let idx = 0;
	while (ranges.length < MAX_MATCHES) {
		const f = tree.text.indexOf(activeNeedle, idx);
		if (f < 0) break;
		const r = rangeFor(tree.segments, f, f + activeNeedle.length);
		if (r) ranges.push(r);
		idx = f + activeNeedle.length;
	}
	// Only the selection itself matched, so there's no "elsewhere" to show, and
	// painting under the native selection would just be noise.
	if (ranges.length < 2) return;
	for (const r of ranges) hl.add(r);
}

function clearSelectionHighlight(): void {
	activeFile = null;
	activeNeedle = '';
	getHighlight()?.clear();
}

function update(): void {
	const found = readSectionSelection();
	if (!found) {
		if (activeFile) clearSelectionHighlight();
		return;
	}
	// Search for the trimmed selection: a double-click word selection can carry
	// trailing whitespace on some platforms, and the identifier is what the user
	// means either way.
	const needle = found.text.trim();
	if (needle.length < MIN_LENGTH || needle.length > MAX_LENGTH || /[\r\n]/.test(needle)) {
		if (activeFile) clearSelectionHighlight();
		return;
	}
	if (found.filePath === activeFile && needle === activeNeedle) return;
	activeFile = found.filePath;
	activeNeedle = needle;
	paint();
}

// Called by the find controller's notifySectionState when a section's Pierre
// render replaces its DOM (bumpRenderEpoch): our painted Ranges now dangle, so
// re-walk and repaint if the occurrences live in that file. If the re-render
// also destroyed the user's selection, the resulting selectionchange clears
// everything right after, which is correct either way.
export function refreshSelectionHighlightsFor(filePath: string): void {
	if (filePath === activeFile) paint();
}

// Install the selectionchange listener. Returns the teardown; DiffView calls
// this from an $effect so the listener lives exactly as long as the diff view.
export function initSelectionHighlight(): () => void {
	let timer: number | null = null;
	const onSelectionChange = (): void => {
		if (timer != null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = null;
			update();
		}, DEBOUNCE_MS);
	};
	document.addEventListener('selectionchange', onSelectionChange);
	return () => {
		document.removeEventListener('selectionchange', onSelectionChange);
		if (timer != null) window.clearTimeout(timer);
		clearSelectionHighlight();
	};
}
