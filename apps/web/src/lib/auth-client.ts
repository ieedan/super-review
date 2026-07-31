import { createAuthClient } from 'better-auth/svelte';
import { convexClient } from '@convex-dev/better-auth/client/plugins';

// No Stripe client plugin: it only exposes the subscription surface
// (upgrade/billingPortal), and Super Review sells a single one-time perpetual
// license. That purchase goes through /checkout/lifetime, which mints the
// Checkout session server-side.
//
// Keep the real inferred client type (signIn/signOut/...); the @mmailaender
// integration only needs a structural subset and gets a cast at the
// createSvelteAuthClient call site.
export const authClient = createAuthClient({
	plugins: [convexClient()]
});
