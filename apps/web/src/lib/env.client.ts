import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const _env = createEnv({
	client: {
		PUBLIC_CONVEX_URL: z.url(),
		// Exclusive instant the launch price ends, so the pricing card can show the
		// discount client-side. Must match the server-side LAUNCH_CUTOFF, which is
		// what actually picks the Stripe price. Optional and fail-closed: with it
		// unset the card just shows the standing price.
		PUBLIC_LAUNCH_CUTOFF: z.string().optional()
	},
	emptyStringAsUndefined: true,
	clientPrefix: 'PUBLIC_',
	runtimeEnv: import.meta.env
});

export const env = {
	..._env,
	PUBLIC_CONVEX_SITE_URL: _env.PUBLIC_CONVEX_URL.replace('.convex.cloud', '.convex.site')
};
