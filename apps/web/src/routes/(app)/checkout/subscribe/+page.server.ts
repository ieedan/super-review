import { redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { hasPaidPlan, isWaitlistBlocked } from '$lib/entitlement';
import type { PageServerLoad } from './$types';

// Auth + beta guard for the subscription checkout. Signed-out users go to sign
// in first (returning here, preserving the chosen billing period), so the
// upgrade never runs unauthenticated. Non-invited waitlist accounts go back to
// the dashboard: they are not allowed to pay until they redeem an invite.
export const load: PageServerLoad = async ({ locals, url }) => {
	// Default to yearly; only `?annual=false` picks monthly.
	const annual = url.searchParams.get('annual') !== 'false';
	const user = await locals.convex.safeQuery(api.auth.getCurrentUser, {}).unwrapOr(null);
	if (!user) {
		const next = `/checkout/subscribe?annual=${annual}`;
		throw redirect(302, `/login?next=${encodeURIComponent(next)}`);
	}

	const invites = await locals.convex.safeQuery(api.invites.getMine, {}).unwrapOr(null);
	if (isWaitlistBlocked(invites)) {
		throw redirect(302, '/dashboard');
	}

	// Someone who already pays (subscription or lifetime) has nothing to buy
	// here. Without this, better-auth's upgrade call 500s: an existing
	// subscription can't be re-created, and a lifetime holder is rejected by the
	// getCheckoutSessionParams guard in auth.ts.
	const license = await locals.convex.safeQuery(api.licenses.getMine, {}).unwrapOr(null);
	if (hasPaidPlan(license)) {
		throw redirect(302, '/dashboard');
	}

	return { annual };
};
