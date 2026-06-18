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
	// The version range exactly as written in package.json (e.g. `^1.2.3`).
	version: string;
}

interface PackageHoverState {
	open: boolean;
	target: PackageHoverTarget | null;
	anchor: AnchorRect | null;
}

const state = $state<PackageHoverState>({ open: false, target: null, anchor: null });

// Exposed read-only-ish view for the card component.
export const packageHover = state;

// The token element the card is currently anchored to, so re-hovering the same
// token is a no-op and doesn't churn the popover.
let anchorEl: HTMLElement | null = null;
// Pending close, so moving between a token and the card (or between two tokens)
// cancels the hide instead of flickering the card closed.
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const HIDE_DELAY_MS = 140;

function cancelHide(): void {
	if (hideTimer != null) {
		clearTimeout(hideTimer);
		hideTimer = null;
	}
}

// Open (or move) the hover card over `element`, showing `target`. Called from
// Pierre's onTokenEnter for a dependency name/version token.
export function showPackageHover(element: HTMLElement, target: PackageHoverTarget): void {
	cancelHide();
	if (
		anchorEl === element &&
		state.open &&
		state.target?.kind === target.kind &&
		state.target?.name === target.name &&
		state.target?.version === target.version
	) {
		return;
	}
	anchorEl = element;
	// Fresh Measurable each move so bits-ui re-anchors to the new token's rect.
	state.anchor = { getBoundingClientRect: () => element.getBoundingClientRect() };
	state.target = target;
	state.open = true;
}

// Begin closing the card after a short grace period. Called from onTokenLeave
// and from the card's own pointerleave — whichever fires last wins, and a
// re-enter (showPackageHover / keepPackageHover) cancels it.
export function scheduleHidePackageHover(): void {
	cancelHide();
	hideTimer = setTimeout(() => {
		hideTimer = null;
		state.open = false;
		state.target = null;
		state.anchor = null;
		anchorEl = null;
	}, HIDE_DELAY_MS);
}

// Keep the card open — the pointer moved onto the card itself.
export function keepPackageHover(): void {
	cancelHide();
}

// Force the card shut immediately (e.g. the popover requested dismissal).
export function closePackageHover(): void {
	cancelHide();
	state.open = false;
	state.target = null;
	state.anchor = null;
	anchorEl = null;
}
