import { redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import type { PageServerLoad } from './$types';

// The device-authorization page. Requires a signed-in user; unauthenticated
// visitors sign in and return here. The desktop opens this page with ?code= so
// the browser can show the code for a visual match and a Confirm/Deny press; a
// direct visit with no code falls back to manual entry.
export const load: PageServerLoad = async ({ url, locals }) => {
	const user = await locals.convex.safeQuery(api.auth.getCurrentUser, {}).unwrapOr(null);
	if (!user) {
		const next = url.search ? `/activate${url.search}` : '/activate';
		throw redirect(302, `/login?next=${encodeURIComponent(next)}`);
	}
	// Whether authorizing this device will actually start the free trial, so the
	// page can promise it only when it's true.
	const eligibility = await locals.convex
		.safeQuery(api.licenses.trialEligibility, {})
		.unwrapOr({ eligible: false });
	return { prefill: url.searchParams.get('code') ?? '', willStartTrial: eligibility.eligible };
};
