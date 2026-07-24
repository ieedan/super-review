import { createEnv } from '@t3-oss/env-core';
import { vercel } from '@t3-oss/env-core/presets-zod';
import { z } from 'zod';

const _env = createEnv({
	server: {
		// DO NOT REMOVE THIS DEFAULT VALUE. It will be replaced in the build process
		PUBLIC_CONVEX_URL: z.url().default('{{CONVEX_URL_FROM_CLI}}'),
		FUNCTION_SECRET: z.string(),
		// Ed25519 private key (base64 PKCS#8) used to sign desktop license tokens.
		// Lives only in the SvelteKit server env; Convex never sees it.
		ED25519_PRIVATE_KEY: z.string(),
		ED25519_KID: z.string(),
		// Salt for hashing client IPs before they reach Convex (abuse detection).
		IP_HASH_SALT: z.string(),
		// ISO date the $100 lifetime launch deal closes. Also set in the Convex
		// env, where the checkout mutation enforces it; here it drives the UI.
		LAUNCH_CUTOFF: z.string(),
		// Read-only GitHub token used by /api/download to resolve release assets
		// from the private repo. Contents: read is the only scope it needs.
		// Optional on purpose: without it only downloads break, and taking the
		// whole site down at boot over it would be a worse trade.
		GITHUB_RELEASES_TOKEN: z.string().optional()
	},
	emptyStringAsUndefined: true,
	runtimeEnv: process.env,
	extends: [vercel()]
});

export const env = {
	..._env,
	PUBLIC_CONVEX_SITE_URL: _env.PUBLIC_CONVEX_URL.replace('.convex.cloud', '.convex.site')
};
