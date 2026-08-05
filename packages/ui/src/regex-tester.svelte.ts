// Shared controller for the inline regex tester. Pierre fires token
// enter/leave/click events from inside each diff's shadow root (see
// DiffFileSection); those call into this singleton, and a single
// <RegexTesterPopup> mounted in the diff view reads the reactive state and
// anchors itself to the literal. Centralizing it means one popup for the whole
// view rather than one per file section, and it keeps "only one tester open at a
// time" true by construction. Mirrors `package-hover.svelte.ts`.
//
// Two surfaces share the state:
//   - a hover hint ("Test regex"), armed after a short rest on the literal;
//   - the tester popup itself, opened by a click and dismissed by Escape, an
//     outside click, or clicking the same literal again.

// A `Measurable`, which is what bits-ui's popover `customAnchor` accepts to position
// against something that isn't a real child element (here, a regex literal
// living in Pierre's shadow DOM). Reads the live rect so it tracks scrolling.
export interface AnchorRect {
	getBoundingClientRect(): DOMRect;
}

export interface RegexTarget {
	// Identity of the literal in the diff: side, line and start column. Used to
	// tell "clicked the open literal again" (close) from "clicked a different
	// one" (retarget), and to keep the hint from re-arming over the open one.
	key: string;
	// The body between the slashes and the trailing flags, as written.
	pattern: string;
	flags: string;
	// `/pattern/flags`, for the popup header.
	source: string;
}

interface RegexTesterState {
	// The hover hint: armed once the pointer has rested on a literal. Suppressed
	// while the tester is open over that same literal.
	hintTarget: RegexTarget | null;
	hintAnchor: AnchorRect | null;
	hintArmed: boolean;
	// The tester popup.
	openTarget: RegexTarget | null;
	openAnchor: AnchorRect | null;
}

const state = $state<RegexTesterState>({
	hintTarget: null,
	hintAnchor: null,
	hintArmed: false,
	openTarget: null,
	openAnchor: null
});

// Exposed read-only-ish view for the popup component.
export const regexTester = state;

// Hover-intent delay before the hint appears on a rested literal, and the grace
// period before it hides, so sliding between two literals doesn't flicker.
const HINT_DELAY_MS = 340;
const HINT_HIDE_MS = 120;

let hintOpenTimer: ReturnType<typeof setTimeout> | null = null;
let hintHideTimer: ReturnType<typeof setTimeout> | null = null;

// ----------------------------------------------------------------------
// Token affordance. The literal's tokens live in Pierre's shadow DOM and Pierre
// re-creates them on every render, so a stylesheet rule would be both hard to
// scope and easily wiped; we set inline styles and restore the prior values
// when the decoration moves. Two independent decorations exist at once (the
// hovered literal and the open one), so each gets its own slot.
// ----------------------------------------------------------------------

interface Decoration {
	elements: HTMLElement[];
	prior: {
		textDecorationLine: string;
		textDecorationStyle: string;
		textUnderlineOffset: string;
		cursor: string;
	}[];
}

const decorations: Record<'hover' | 'active', Decoration | null> = { hover: null, active: null };

// The Pierre container each surface is anchored into, so a section tearing its
// diff down can close exactly what belonged to it (see `closeRegexTesterFor`)
// and the anchors can fall back to a host-relative rect after a rerender.
let hoverHost: Element | null = null;
let activeHost: Element | null = null;

function sameElements(a: HTMLElement[], b: HTMLElement[]): boolean {
	return a.length === b.length && a.every((el, i) => el === b[i]);
}

function clearDecoration(slot: 'hover' | 'active'): void {
	const current = decorations[slot];
	if (!current) return;
	current.elements.forEach((el, i) => {
		const prior = current.prior[i];
		el.style.textDecorationLine = prior.textDecorationLine;
		el.style.textDecorationStyle = prior.textDecorationStyle;
		el.style.textUnderlineOffset = prior.textUnderlineOffset;
		el.style.cursor = prior.cursor;
	});
	decorations[slot] = null;
}

// Underline every token fragment of the literal so the whole `/pattern/flags`
// reads as one interactive thing, and switch the cursor to a pointer since a
// click does something. The open literal gets a solid underline, a hovered one
// a dashed hint.
function applyDecoration(slot: 'hover' | 'active', elements: HTMLElement[]): void {
	const current = decorations[slot];
	if (current && sameElements(current.elements, elements)) return;
	clearDecoration(slot);
	if (elements.length === 0) return;
	const prior = elements.map((el) => ({
		textDecorationLine: el.style.textDecorationLine,
		textDecorationStyle: el.style.textDecorationStyle,
		textUnderlineOffset: el.style.textUnderlineOffset,
		cursor: el.style.cursor
	}));
	for (const el of elements) {
		el.style.textDecorationLine = 'underline';
		el.style.textDecorationStyle = slot === 'active' ? 'solid' : 'dashed';
		el.style.textUnderlineOffset = '3px';
		el.style.cursor = 'pointer';
	}
	decorations[slot] = { elements, prior };
}

// ----------------------------------------------------------------------
// Anchoring
// ----------------------------------------------------------------------

// Build a Measurable spanning every token fragment of the literal, so the popup
// anchors to the whole `/pattern/flags` rather than to whichever fragment the
// pointer happened to be over.
//
// Pierre rebuilds its shadow DOM on rerender (an annotation change, the worker's
// highlighted-AST swap), which detaches the fragments we captured: their rects
// go to zero and the popup would jump to the viewport corner. `host` is the
// element Pierre renders into, which outlives those rerenders, so we remember
// where the literal sat inside it and re-derive the rect from the host's live
// position. The popup then keeps tracking the code as the user scrolls, even
// though the elements it was measured from are gone.
function anchorFor(elements: HTMLElement[], host: Element | null): AnchorRect {
	// Offsets of the last good rect relative to the host's top-left.
	let offset: { x: number; y: number; width: number; height: number } | null = null;
	return {
		getBoundingClientRect(): DOMRect {
			let left = Infinity;
			let top = Infinity;
			let right = -Infinity;
			let bottom = -Infinity;
			for (const el of elements) {
				if (!el.isConnected) continue;
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 && rect.height === 0) continue;
				left = Math.min(left, rect.left);
				top = Math.min(top, rect.top);
				right = Math.max(right, rect.right);
				bottom = Math.max(bottom, rect.bottom);
			}
			const hostRect = host?.isConnected ? host.getBoundingClientRect() : null;
			if (left !== Infinity) {
				if (hostRect) {
					offset = {
						x: left - hostRect.left,
						y: top - hostRect.top,
						width: right - left,
						height: bottom - top
					};
				}
				return new DOMRect(left, top, right - left, bottom - top);
			}
			if (hostRect && offset) {
				return new DOMRect(
					hostRect.left + offset.x,
					hostRect.top + offset.y,
					offset.width,
					offset.height
				);
			}
			return new DOMRect(0, 0, 0, 0);
		}
	};
}

// ----------------------------------------------------------------------
// Hover hint
// ----------------------------------------------------------------------

function cancelHintOpen(): void {
	if (hintOpenTimer != null) {
		clearTimeout(hintOpenTimer);
		hintOpenTimer = null;
	}
}

function cancelHintHide(): void {
	if (hintHideTimer != null) {
		clearTimeout(hintHideTimer);
		hintHideTimer = null;
	}
}

function resetHint(): void {
	state.hintArmed = false;
	state.hintTarget = null;
	state.hintAnchor = null;
	hoverHost = null;
	clearDecoration('hover');
}

// The pointer entered a regex literal: decorate its tokens straight away (that
// affordance should feel instant) and arm the hint after the intent delay.
// `elements` are all the token fragments making up the literal, in source order;
// `host` is the element Pierre rendered them into (see `anchorFor`).
export function showRegexHint(
	elements: HTMLElement[],
	host: Element | null,
	target: RegexTarget
): void {
	cancelHintHide();
	applyDecoration('hover', elements);
	hoverHost = host;
	// The open literal already says what it is; a hint over it would just cover
	// the popup's own anchor.
	if (state.openTarget?.key === target.key) {
		resetHintState();
		return;
	}
	state.hintAnchor = anchorFor(elements, host);
	state.hintTarget = target;
	// Already showing (or counting down): retarget without restarting the delay,
	// so sliding along a line of literals keeps the hint alive.
	if (state.hintArmed || hintOpenTimer != null) return;
	hintOpenTimer = setTimeout(() => {
		hintOpenTimer = null;
		state.hintArmed = true;
	}, HINT_DELAY_MS);
}

// Drop the hint's popup state but keep the token decoration (used when the
// pointer is over the literal the tester is already open on).
function resetHintState(): void {
	cancelHintOpen();
	state.hintArmed = false;
	state.hintTarget = null;
	state.hintAnchor = null;
}

// The pointer left the literal (or moved to a non-regex token). Hides after a
// grace period so a re-enter cancels it.
export function scheduleHideRegexHint(): void {
	cancelHintOpen();
	cancelHintHide();
	hintHideTimer = setTimeout(() => {
		hintHideTimer = null;
		resetHint();
	}, HINT_HIDE_MS);
}

// ----------------------------------------------------------------------
// Tester popup
// ----------------------------------------------------------------------

// Click on a regex literal: open the tester on it, or close it if that literal
// is the one already open (clicking the regex again is one of the documented
// ways out).
export function toggleRegexTester(
	elements: HTMLElement[],
	host: Element | null,
	target: RegexTarget
): void {
	if (state.openTarget?.key === target.key) {
		closeRegexTester();
		return;
	}
	// The hint has served its purpose; the popup replaces it.
	cancelHintOpen();
	cancelHintHide();
	resetHint();
	applyDecoration('active', elements);
	activeHost = host;
	state.openAnchor = anchorFor(elements, host);
	state.openTarget = target;
}

// Close the tester (Escape, an outside click, the popover requesting dismissal,
// or the anchoring diff being torn down).
export function closeRegexTester(): void {
	state.openTarget = null;
	state.openAnchor = null;
	activeHost = null;
	clearDecoration('active');
}

// Close whatever this host is anchoring. Called when a file section disposes
// its diff, whose shadow DOM is about to be destroyed along with the tokens.
// Identity-checked against the host rather than the tokens because the tester,
// unlike the hover card, survives the pointer leaving: an unrelated file
// re-rendering must not shut it.
export function closeRegexTesterFor(host: Element): void {
	if (activeHost === host) closeRegexTester();
	if (hoverHost === host) {
		cancelHintOpen();
		cancelHintHide();
		resetHint();
	}
}
