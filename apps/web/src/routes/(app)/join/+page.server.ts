import { redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import type { PageServerLoad } from './$types';

/**
 * The landing point for an invite link: /join?code=SUPER-XXXX-XXXX
 *
 * Redeems server-side and forwards to the dashboard, so the happy path is one
 * click from the email with no form, no flash of an intermediate state, and no
 * dependency on client JS. Only a failure renders anything.
 *
 * Redemption binds the code permanently to whichever account is signed in, so
 * this is deliberately a distinct URL rather than something the dashboard does
 * on load: arriving here is an explicit act, not a side effect of visiting.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const code = url.searchParams.get('code')?.trim();

	// Nothing to redeem: the dashboard already handles the manual-entry case.
	if (!code) throw redirect(302, '/dashboard');

	const user = await locals.convex.safeQuery(api.auth.getCurrentUser, {}).unwrapOr(null);
	if (!user) {
		// Carry the whole path so the code survives sign-in. The login page also
		// stashes it client-side in case the query is lost on the OAuth round trip.
		throw redirect(302, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const res = await locals.convex.safeMutation(api.invites.redeem, { code });

	if (res.isErr()) {
		// The beta is over and the app is open to everyone, so an old link in
		// someone's inbox should quietly deliver them to the dashboard rather than
		// telling them their code failed. They already have access.
		if (res.error.code === 'INVITE_CODES_CLOSED') throw redirect(303, '/dashboard');

		// Render other failures rather than bouncing, so the reason is visible and
		// the code is still in front of them to check or pass on.
		const reason =
			res.error.code === 'RATE_LIMITED'
				? 'too_many_attempts'
				: res.error.code === 'INVALID_INVITE_CODE'
					? 'invalid_code'
					: 'unknown';
		return { failed: true as const, reason, code, email: user.email };
	}

	// Redeemed, or they were already a member. Either way they belong on the
	// dashboard, where the download and their guest codes are.
	throw redirect(303, '/dashboard');
};
