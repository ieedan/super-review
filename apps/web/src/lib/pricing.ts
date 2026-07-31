// What Super Review costs, in one place. Imported by the marketing pricing card
// (display) and by the Convex checkout action (which price id to charge), so the
// number on the page and the number Stripe bills can never drift apart.
//
// The dollar figures here are display only. Stripe is the source of truth for
// what is actually charged, via STRIPE_PRICE_LIFETIME / STRIPE_PRICE_LAUNCH, so
// changing a constant here without changing the Stripe price just makes the page
// lie. Change both.

/** The standing price of the perpetual license. */
export const BASE_PRICE = 59.99;

/** The launch price, charged while the launch window is open. */
export const LAUNCH_PRICE = 39.99;

/**
 * Is the launch price still on offer?
 *
 * `cutoffIso` is the **exclusive** instant the offer ends - at that moment the
 * price goes back to `BASE_PRICE`. Anything `Date.parse` understands works, so a
 * bare `2026-09-01` (UTC midnight) or a zoned `2026-09-01T07:00:00Z` both do.
 *
 * Fails **closed**: an unset or unparseable cutoff means the window is shut and
 * everyone pays full price. The alternative fails the wrong way - a typo'd or
 * missing env var would quietly discount every sale, and the only signal would
 * be the revenue.
 */
export function isLaunchOpen(cutoffIso: string | undefined | null, now: number): boolean {
	if (!cutoffIso) return false;
	const cutoff = Date.parse(cutoffIso);
	return Number.isFinite(cutoff) && now < cutoff;
}

/**
 * The last day the launch price is available, derived from the exclusive cutoff
 * by stepping back a millisecond. Deriving it rather than storing a second date
 * is what stops the card promising "through August 31" while checkout has
 * already reverted to full price that morning.
 *
 * Returns null when there is no usable cutoff (see isLaunchOpen).
 */
export function launchLastDay(cutoffIso: string | undefined | null): Date | null {
	if (!cutoffIso) return null;
	const cutoff = Date.parse(cutoffIso);
	if (!Number.isFinite(cutoff)) return null;
	return new Date(cutoff - 1);
}

/** `59.99` -> `$59.99`. Both prices carry cents, so the decimals always show. */
export function formatPrice(amount: number): string {
	return `$${amount.toFixed(2)}`;
}
