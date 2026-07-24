import type { LayoutServerLoad } from './$types';

// Tell the client whether this SSR pass was authenticated (the Convex JWT
// cookie was present). createSvelteAuthClient seeds setupAuth with it, which
// pauses the WebSocket until the real token is fetched. Without this, deferred
// query subscriptions fire unauthenticated on hydration, soft-auth queries
// like licenses.getMine briefly resolve null, and SSR data flashes away and
// back once auth settles.
export const load: LayoutServerLoad = ({ locals }) => {
	return { authState: { isAuthenticated: !!locals.token } };
};
