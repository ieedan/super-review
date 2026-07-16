// VS Code style indentation guides for the diff view.
//
// @pierre/diffs has no built-in indent guides, so we paint them ourselves
// after each render, the same way the staging gutter and find highlights
// post-process Pierre's shadow DOM. Every rendered code line is a
// `[data-line]` div inside a `[data-content]` column wrapper; we give each
// line a repeating vertical-stripe background (one 1px stripe per indent
// level) sized to that line's leading whitespace, so the stripes read as
// scope guides. Blank lines extend the guides of their neighbors, matching
// the editor behavior (a blank line inside a block still shows the block's
// guides).
//
// The stripes are drawn with CSS only: an injected stylesheet targets
// `[data-sr-indent-guides]` and each line carries its guide width in an
// inline `--sr-ig-w` custom property. The stylesheet is unlayered, so it
// outranks Pierre's own `@layer` rules for the background-image longhands
// while leaving Pierre's line background-color untouched.

// Pierre renders tabs at `tab-size: var(--diffs-tab-size, 2)` and the app
// never overrides the variable, so a tab advances to the next multiple of 2
// columns. Guide positions are computed in the same column space so they
// line up with the rendered text for tab-indented files too.
export const DIFF_TAB_SIZE = 2;

// Fallback indent step (in columns) when a file offers no evidence of its
// indent unit, e.g. a flat file with no nested blocks.
const DEFAULT_INDENT_STEP = 4;

// Cap the number of lines scanned for indent-step detection so huge files
// don't pay for a full pass; the unit is virtually always established well
// before this.
const DETECT_SCAN_LIMIT = 5000;

const STYLE_ID = 'sr-indent-guides-style';
const LINE_ATTR = 'data-sr-indent-guides';
const WIDTH_PROP = '--sr-ig-w';
export const STEP_PROP = '--sr-ig-step';

// `background-size` clips the repeating stripe pattern to the line's own
// indentation, so a line indented N levels shows stripes at levels 0..N-1
// (the stripe that would sit exactly at the text start column falls outside
// the box and is clipped). `background-origin: content-box` anchors column 0
// at the text start (the code lines carry a padding-left for the gutter
// seam); background-clip is left at its border-box default on purpose so the
// line's own background-color keeps filling the padding strip.
const GUIDES_CSS = `
[${LINE_ATTR}] {
	background-image: repeating-linear-gradient(
		to right,
		var(--sr-ig-color, color-mix(in srgb, currentColor 14%, transparent)) 0 1px,
		transparent 1px var(${STEP_PROP}, ${DEFAULT_INDENT_STEP}ch)
	);
	background-size: var(${WIDTH_PROP}, 0) 100%;
	background-repeat: no-repeat;
	background-origin: content-box;
}
`;

// Width of a line's leading whitespace in columns, or null for a blank
// (empty / whitespace-only) line. Tabs advance to the next tab stop.
export function leadingWidth(text: string, tabSize: number = DIFF_TAB_SIZE): number | null {
	let col = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 32 /* space */) col++;
		else if (ch === 9 /* tab */) col += tabSize - (col % tabSize);
		else if (ch === 13 /* CR */ || ch === 10 /* LF */) return null;
		else return col;
	}
	return null;
}

// Guess the file's indent unit in columns: the most common positive indent
// increase between consecutive non-blank lines. Falls back to
// DEFAULT_INDENT_STEP when the file shows no nesting at all.
export function detectIndentStep(contents: string, tabSize: number = DIFF_TAB_SIZE): number {
	const counts = new Map<number, number>();
	let prev: number | null = null;
	let start = 0;
	let scanned = 0;
	while (start <= contents.length && scanned < DETECT_SCAN_LIMIT) {
		let end = contents.indexOf('\n', start);
		if (end === -1) end = contents.length;
		const width = leadingWidth(contents.slice(start, end), tabSize);
		if (width != null) {
			if (prev != null) {
				const delta = width - prev;
				// Indent units are small; larger jumps are continuations or
				// alignment, not a nesting level.
				if (delta >= 1 && delta <= 8) counts.set(delta, (counts.get(delta) ?? 0) + 1);
			}
			prev = width;
		}
		scanned++;
		if (end === contents.length) break;
		start = end + 1;
	}
	let best = 0;
	let bestCount = 0;
	for (const [delta, count] of counts) {
		if (count > bestCount || (count === bestCount && delta < best)) {
			best = delta;
			bestCount = count;
		}
	}
	return best > 0 ? best : DEFAULT_INDENT_STEP;
}

// Fill in guide widths for blank lines from their nearest non-blank
// neighbors in the same column: min(previous, next), or whichever side
// exists. This is what extends guides through the empty lines inside a
// block without leaking them past the block's end.
export function resolveBlankWidths(widths: (number | null)[]): number[] {
	const resolved = new Array<number>(widths.length);
	// Nearest non-blank width below each line, computed in one backward pass.
	const nextNonBlank = new Array<number>(widths.length);
	let next = -1;
	for (let i = widths.length - 1; i >= 0; i--) {
		const w = widths[i];
		if (w != null) next = w;
		nextNonBlank[i] = next;
	}
	let prev = -1;
	for (let i = 0; i < widths.length; i++) {
		const w = widths[i];
		if (w != null) {
			resolved[i] = w;
			prev = w;
			continue;
		}
		const n = nextNonBlank[i];
		if (prev >= 0 && n >= 0) resolved[i] = Math.min(prev, n);
		else if (prev >= 0) resolved[i] = prev;
		else if (n >= 0) resolved[i] = n;
		else resolved[i] = 0;
	}
	return resolved;
}

function ensureStyles(root: ShadowRoot): void {
	if (root.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = GUIDES_CSS;
	root.appendChild(style);
}

// Paint (or repaint) indent guides across every rendered column in a Pierre
// shadow root. Each `[data-content]` wrapper is one column of code lines in
// visual order (unified view has one, split view one per side), so blank-line
// extension is computed per column exactly as it will be seen. Idempotent:
// re-running reconciles attributes, so it is safe to call after every Pierre
// render/rerender and again when the setting toggles.
export function applyIndentGuides(root: ShadowRoot, step: number): void {
	ensureStyles(root);
	// The step is per file, not per line: custom properties inherit from the
	// host element through the shadow boundary.
	(root.host as HTMLElement).style.setProperty(STEP_PROP, `${step}ch`);
	const columns = root.querySelectorAll<HTMLElement>('[data-content]');
	for (const column of columns) {
		const lines = column.querySelectorAll<HTMLElement>('[data-line]');
		const widths: (number | null)[] = new Array(lines.length);
		for (let i = 0; i < lines.length; i++) {
			widths[i] = leadingWidth(lines[i].textContent ?? '', DIFF_TAB_SIZE);
		}
		const resolved = resolveBlankWidths(widths);
		for (let i = 0; i < lines.length; i++) {
			const el = lines[i];
			const w = resolved[i];
			if (w > 0) {
				el.setAttribute(LINE_ATTR, '');
				el.style.setProperty(WIDTH_PROP, `${w}ch`);
			} else if (el.hasAttribute(LINE_ATTR)) {
				el.removeAttribute(LINE_ATTR);
				el.style.removeProperty(WIDTH_PROP);
			}
		}
	}
}

// Turn the guides off for a rendered section without forcing a Pierre
// re-render: dropping the stylesheet is enough (the per-line attributes are
// inert without it, and the next applyIndentGuides pass reconciles them).
export function clearIndentGuides(root: ShadowRoot): void {
	root.getElementById(STYLE_ID)?.remove();
}
