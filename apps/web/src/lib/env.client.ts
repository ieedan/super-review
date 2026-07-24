import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const _env = createEnv({
	client: {
		PUBLIC_CONVEX_URL: z.url(),
		// ISO date the $100 lifetime launch deal closes. Public so the prerendered
		// homepage pricing can show/hide the lifetime option client-side. Must match
		// the server-side LAUNCH_CUTOFF (which is what actually enforces it).
		PUBLIC_LAUNCH_CUTOFF: z.string().default('2099-01-01')
	},
	emptyStringAsUndefined: true,
	clientPrefix: 'PUBLIC_',
	runtimeEnv: import.meta.env
});

export const env = {
	..._env,
	PUBLIC_CONVEX_SITE_URL: _env.PUBLIC_CONVEX_URL.replace('.convex.cloud', '.convex.site')
};
