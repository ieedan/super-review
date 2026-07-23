import { redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { isWaitlistPending } from '$lib/entitlement';
import type { PageServerLoad } from './$types';

// Create the lifetime Checkout session server-side and redirect straight to
// Stripe. Doing it here (cookie auth) rather than client-side avoids the race
// where the Convex socket hasn't picked up the auth token yet right after the
// OAuth return, which made the action run unauthenticated and fall through to
// the dashboard. Non-invited waitlist accounts never reach Stripe.
export const load: PageServerLoad = async ({ locals }) => {
	const user = await locals.convex.safeQuery(api.auth.getCurrentUser, {}).unwrapOr(null);
	if (!user) {
		throw redirect(302, `/login?next=${encodeURIComponent('/checkout/lifetime')}`);
	}

	const invites = await locals.convex.safeQuery(api.invites.getMine, {}).unwrapOr(null);
	if (isWaitlistPending(invites)) {
		throw redirect(302, '/dashboard');
	}

	const res = await locals.convex.safeAction(api.billing.createLifetimeCheckout, {});
	if (res.isErr()) {
		throw redirect(303, `/dashboard?checkout_error=${encodeURIComponent(res.error.code)}`);
	}
	throw redirect(303, res.value.url);
};
