// Shared controller for the package.json hover card. Pierre fires token
// enter/leave events from inside each diff's shadow root (see DiffFileSection);
// those call into this singleton, and a single <PackageHoverCard> mounted in
// the diff view reads the reactive state and anchors itself to the hovered
// token. Centralizing it means one card for the whole view rather than one per
// file section, and lets the card itself keep the popover open while the
// pointer is over it (so its links are clickable).

// A `Measurable` — what bits-ui's popover `customAnchor` accepts to position
// against something that isn't a real child element (here, a token living in
// Pierre's shadow DOM). Reads the live rect so the card tracks scrolling.
export interface AnchorRect {
	getBoundingClientRect(): DOMRect;
}

export interface PackageHoverTarget {
	// Whether the pointer is over the package name or its version range.
	kind: 'name' | 'version';
	name: string;
	// The version range exactly as written in package.json (e.g. `^1.2.3`) on the
	// side the pointer is over.
	version: string;
	// The package's version range on each side of the diff (resolved by name from
	// both side indexes), so the card can show a range changelog when it changed.
	// null when the dependency is absent on that side (added / removed).
	oldRange?: string | null;
	newRange?: string | null;
}

interface PackageHoverState {
	// `armed` = the controller wants the card shown: the hover-intent delay has
	// elapsed and the pointer is still engaged. The card additionally waits for
	// npm content to load before actually opening, so no loading state flashes
	// (see PackageHoverCard's `cardOpen`).
	armed: boolean;
	target: PackageHoverTarget | null;
	anchor: AnchorRect | null;
}

const state = $state<PackageHoverState>({ armed: false, target: null, anchor: null });

// Exposed read-only-ish view for the card component.
export const packageHover = state;

// Pending close, so moving between a token and the card (or between two tokens)
// cancels the hide instead of flickering the card closed.
let hideTimer: ReturnType<typeof setTimeout> | null = null;
// Pending open: a quick sweep across a package.json doesn't pop the card; it
// only arms once the pointer has rested on a dependency for OPEN_DELAY_MS.
let openTimer: ReturnType<typeof setTimeout> | null = null;
// Pinned by the card while its changelog disclosure is expanded, so the card can
// grow (and the popover flip side to stay on-screen) without a pointer-leave
// dismissing it out from under the user.
let pinned = false;

// Hover-intent delay before the card appears on a rested token.
const OPEN_DELAY_MS = 320;
const HIDE_DELAY_MS = 140;

// The token element currently wearing the hover affordance, and the inline
// style values we overwrote, so leaving restores it exactly. Only one token is
// ever decorated at a time, so a single snapshot suffices (no per-element map).
let styledEl: HTMLElement | null = null;
let styledPrior: {
	textDecorationLine: string;
	textDecorationStyle: string;
	textUnderlineOffset: string;
	cursor: string;
} | null = null;

// Give the hovered dependency token a dotted underline + help cursor so it
// reads as interactive. Applied via inline styles (the token lives in Pierre's
// shadow DOM, and Pierre re-creates these elements, so a stylesheet rule would
// be both hard to scope and easily wiped); we restore the prior values on leave.
function applyAffordance(element: HTMLElement): void {
	if (styledEl === element) return;
	restoreAffordance();
	styledPrior = {
		textDecorationLine: element.style.textDecorationLine,
		textDecorationStyle: element.style.textDecorationStyle,
		textUnderlineOffset: element.style.textUnderlineOffset,
		cursor: element.style.cursor
	};
	element.style.textDecorationLine = 'underline';
	element.style.textDecorationStyle = 'dotted';
	element.style.textUnderlineOffset = '2px';
	element.style.cursor = 'help';
	styledEl = element;
}

function restoreAffordance(): void {
	if (styledEl && styledPrior) {
		styledEl.style.textDecorationLine = styledPrior.textDecorationLine;
		styledEl.style.textDecorationStyle = styledPrior.textDecorationStyle;
		styledEl.style.textUnderlineOffset = styledPrior.textUnderlineOffset;
		styledEl.style.cursor = styledPrior.cursor;
	}
	styledEl = null;
	styledPrior = null;
}

function cancelHide(): void {
	if (hideTimer != null) {
		clearTimeout(hideTimer);
		hideTimer = null;
	}
}

function cancelOpen(): void {
	if (openTimer != null) {
		clearTimeout(openTimer);
		openTimer = null;
	}
}

// Tear the card down: disarm, drop target/anchor, restore the token styling.
function reset(): void {
	state.armed = false;
	state.target = null;
	state.anchor = null;
	restoreAffordance();
}

// Open (or move) the hover card over `element`, showing `target`. Called from
// Pierre's onTokenEnter for a dependency name/version token.
export function showPackageHover(element: HTMLElement, target: PackageHoverTarget): void {
	cancelHide();
	applyAffordance(element);
	// Fresh Measurable each move so bits-ui re-anchors to the new token's rect.
	state.anchor = { getBoundingClientRect: () => element.getBoundingClientRect() };
	state.target = target;
	// Already shown (or counting down to show): keep it and just retarget. Only
	// start the intent delay when opening fresh, so sliding between tokens doesn't
	// restart the timer or flicker the card closed.
	if (state.armed || openTimer != null) return;
	openTimer = setTimeout(() => {
		openTimer = null;
		state.armed = true;
	}, OPEN_DELAY_MS);
}

// Begin closing the card after a short grace period. Called from onTokenLeave
// and from the card's own pointerleave — whichever fires last wins, and a
// re-enter (showPackageHover / keepPackageHover) cancels it.
export function scheduleHidePackageHover(): void {
	// While pinned (changelog expanded) the card dismisses itself via outside-
	// click / Escape, so ignore pointer-leave hides entirely.
	if (pinned) return;
	cancelOpen();
	cancelHide();
	hideTimer = setTimeout(() => {
		hideTimer = null;
		reset();
	}, HIDE_DELAY_MS);
}

// Keep the card open — the pointer moved onto the card itself.
export function keepPackageHover(): void {
	cancelHide();
}

// Force the card shut immediately (e.g. the popover requested dismissal).
export function closePackageHover(): void {
	pinned = false;
	cancelOpen();
	cancelHide();
	reset();
}

// Pin / unpin the card open. The card pins itself while the changelog disclosure
// is expanded so the content can grow (and the popover flip side) without a
// pointer-leave tearing it down.
export function setPackageHoverPinned(value: boolean): void {
	pinned = value;
	if (pinned) cancelHide();
}
