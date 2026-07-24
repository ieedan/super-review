import { redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import type { PageServerLoad } from './$types';

// The device-authorization page. Requires a signed-in user; unauthenticated
// visitors sign in and return here. An optional ?code= prefills the input (the
// desktop just displays the code, so this is only a convenience).
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
