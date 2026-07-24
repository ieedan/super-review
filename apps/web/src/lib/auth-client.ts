import { createAuthClient } from 'better-auth/svelte';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { stripeClient } from '@better-auth/stripe/client';

// Keep the real inferred client type (signIn/signOut/subscription/...); the
// @mmailaender integration only needs a structural subset and gets a cast at
// the createSvelteAuthClient call site.
export const authClient = createAuthClient({
	plugins: [convexClient(), stripeClient({ subscription: true })]
});
