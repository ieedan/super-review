import { redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { isWaitlistPending } from '$lib/entitlement';
import type { PageServerLoad } from './$types';

/**
 * Pricing is public once launched. While waitlist mode is on it requires a
 * signed-in beta member: we don't advertise prices to the world, and
 * non-invited accounts must not reach checkout yet. Invited users still need
 * this page (the desktop "Upgrade" link lands here).
 *
 * Checkout enforces the same membership rule (and its own paid-plan / launch
 * window guards), so deep links cannot bypass this.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const settings = await locals.convex.safeQuery(api.settings.getPublic, {}).unwrapOr(null);
	if (!settings?.waitlistMode) return {};

	const user = await locals.convex.safeQuery(api.auth.getCurrentUser, {}).unwrapOr(null);
	if (!user) {
		throw redirect(302, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const invites = await locals.convex.safeQuery(api.invites.getMine, {}).unwrapOr(null);
	if (isWaitlistPending(invites)) {
		throw redirect(302, '/dashboard');
	}
	return {};
};
