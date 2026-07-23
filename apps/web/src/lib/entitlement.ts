import type { Doc } from '$lib/convex/_generated/dataModel';

/** What `licenses.getMine` can return: the row, the auth-settling sentinel, or
 * null when the user has no license yet. */
export type MaybeLicense = Doc<'licenses'> | 'unauthenticated' | null;

/** Shape of `invites.getMine` when auth has settled (excludes the sentinel). */
export type InvitesMine = {
	waitlistMode: boolean;
	isMember: boolean;
};

/**
 * True when the account is already on a paid plan that is currently in good
 * standing. Used to keep paying users out of checkout, where a second purchase
 * would either fail or double-charge.
 *
 * A `trial` plan is deliberately not paid: trial users are exactly who should
 * be able to subscribe.
 */
export function hasPaidPlan(license: MaybeLicense): boolean {
	if (!license || license === 'unauthenticated') return false;
	if (license.plan === 'none' || license.plan === 'trial') return false;
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
