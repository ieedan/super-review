import { redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import type { PageServerLoad } from './$types';

// Guard: the license queries throw when unauthenticated, so bounce signed-out
// visitors to sign in (returning here) before the universal load runs
// convexLoad against them.
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = await locals.convex.safeQuery(api.auth.getCurrentUser, {}).unwrapOr(null);
	if (!user) {
		// Carry the query string, not just the path: an invite link arrives as
		// /dashboard?code=..., and hardcoding the path here would drop the code on
		// the way through sign-in.
		throw redirect(302, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	}
	// Belt and braces with the databaseHooks in convex/auth.ts, which join on
	// signup and on every sign-in. Those cover new sessions; this covers anyone
	// whose session predates them, so there is no route that leaves someone
	// signed in and silently off the list.
	//
	// Idempotent, and a no-op when waitlist mode is off or the account is already
	// a member. Non-fatal: the panel reads the real state separately, so a failure
	// here shows the honest "join the waitlist" copy rather than breaking.
	await locals.convex.safeMutation(api.waitlist.joinAsCurrentUser, {});

	return {
		holderName: user.name || user.email,
		// Who the dashboard is showing. Rendered as the signed-in account chip so
		// it's obvious which account these licenses and devices belong to.
		account: { name: user.name || null, email: user.email, image: user.image ?? null }
	};
};
