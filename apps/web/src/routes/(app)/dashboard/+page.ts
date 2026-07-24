import { convexLoad } from 'convex-svelte/sveltekit';
import { api } from '$lib/convex/_generated/api';
import type { PageLoad } from './$types';

// Fetch the license + devices on the server (auth token picked up from
// withServerConvexToken in hooks.server.ts) so they render with SSR - no client
// loading flash - then transport upgrades them to live subscriptions on the
// client, so a revoke reflects immediately.
export const load: PageLoad = async ({ data }) => ({
	...data,
	license: await convexLoad(api.licenses.getMine, {}),
	devices: await convexLoad(api.licenses.getMyDevices, {}),
	// Live, so redeeming a code flips the dashboard from the invite form to the
	// download buttons (and reveals the guest codes) without a reload.
	invites: await convexLoad(api.invites.getMine, {})
});
