import type { Doc } from '$lib/convex/_generated/dataModel';
import { WAITLIST_MODE_DEFAULT } from '$lib/convex/settingsShared';

/** What `licenses.getMine` can return: the row, the auth-settling sentinel, or
 * null when the user has no license yet. */
export type MaybeLicense = Doc<'licenses'> | 'unauthenticated' | null;

/** Shape of `invites.getMine` when auth has settled (excludes the sentinel). */
export type InvitesMine = {
	waitlistMode: boolean;
	isMember: boolean;
};

/**
 * True when the account already owns the perpetual license and it is in good
 * standing. Used to keep owners out of checkout, where a second purchase would
 * either fail or double-charge.
 *
 * A `trial` plan is deliberately not paid: trial users are exactly who should
 * be able to buy.
 */
export function hasPaidPlan(license: MaybeLicense): boolean {
	if (!license || license === 'unauthenticated') return false;
	if (license.plan !== 'lifetime') return false;
	return license.status === 'active' || license.status === 'trialing';
}

/**
 * True when waitlist mode is on and this account has not redeemed an invite.
 * Pricing and checkout stay closed to those accounts until they are in the beta.
 * Returns false while auth/invites are still settling so a blip cannot lock
 * someone out incorrectly; Convex billing guards re-check server-side.
 */
export function isWaitlistPending(
	invites: InvitesMine | 'unauthenticated' | null | undefined
): boolean {
	if (!invites || invites === 'unauthenticated') return false;
	return invites.waitlistMode && !invites.isMember;
}

/**
 * The same question, asked by a server load that is about to hand something out
 * (prices, a checkout session, a binary). Identical when the answer is known;
 * the difference is the unknown case.
 *
 * `isWaitlistPending` treats a missing answer as "not pending" because it drives
 * copy on a page the user is already looking at, and a blip there should not
 * accuse a paying member of being uninvited. A gate has the opposite risk: the
 * caller has already established there is a signed-in user, so no invites answer
 * means the query failed, and guessing "allowed" is how a closed beta leaks. The
 * cost of guessing wrong the other way is a redirect to the dashboard, which is
 * a page, not a lockout.
 */
export function isWaitlistBlocked(
	invites: InvitesMine | 'unauthenticated' | null | undefined
): boolean {
	if (!invites || invites === 'unauthenticated') return WAITLIST_MODE_DEFAULT;
	return invites.waitlistMode && !invites.isMember;
}

/**
 * Waitlist mode as read from a `settings.getPublic` load result, falling back to
 * the closed default whenever the flag has not arrived - the query failed, or
 * the subscription has not resolved yet. Used by the marketing surfaces so an
 * unanswered settings query renders the pre-launch page rather than flashing
 * buy CTAs.
 */
export function waitlistModeFrom(
	settings: { data?: { waitlistMode: boolean } | null } | null | undefined
): boolean {
	return settings?.data?.waitlistMode ?? WAITLIST_MODE_DEFAULT;
}
