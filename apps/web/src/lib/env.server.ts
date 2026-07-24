import { createEnv } from '@t3-oss/env-core';
import { vercel } from '@t3-oss/env-core/presets-zod';
import { z } from 'zod';

// Every one of these values is a single-line secret or identifier, and every one
// of them arrives from a provider dashboard or CLI where a stray newline is easy
// to introduce (`vercel env add` stores the trailing newline it is piped, and a
// copy-paste out of a terminal often carries one too). Trimming here is the one
// place that covers all of them: an untrimmed ED25519_KID once shipped a
// "lk_63d406cf\n" kid in every signed license token, which no desktop build
// could match against its embedded key map, so activation silently never
// unlocked.
const line = () => z.string().trim();

const _env = createEnv({
	server: {
		// DO NOT REMOVE THIS DEFAULT VALUE. It will be replaced in the build process
		// z.url() already normalizes away stray whitespace, so this one needs no trim.
		PUBLIC_CONVEX_URL: z.url().default('{{CONVEX_URL_FROM_CLI}}'),
		FUNCTION_SECRET: line(),
		// Ed25519 private key (base64 PKCS#8) used to sign desktop license tokens.
		// Lives only in the SvelteKit server env; Convex never sees it.
		ED25519_PRIVATE_KEY: line(),
		// Rides verbatim in the `kid` header of every license token, where the
		// desktop looks it up in LICENSE_PUBLIC_KEYS by exact string match. It must
		// be exactly the key id, with no surrounding whitespace.
		ED25519_KID: line(),
		// Salt for hashing client IPs before they reach Convex (abuse detection).
		IP_HASH_SALT: line(),
		// ISO date the $100 lifetime launch deal closes. Also set in the Convex
		// env, where the checkout mutation enforces it; here it drives the UI.
		LAUNCH_CUTOFF: line(),
		// Read-only GitHub token used by /api/download to resolve release assets
		// from the private repo. Contents: read is the only scope it needs.
		// Optional on purpose: without it only downloads break, and taking the
		// whole site down at boot over it would be a worse trade.
		GITHUB_RELEASES_TOKEN: line().optional()
	},
	emptyStringAsUndefined: true,
	runtimeEnv: process.env,
	extends: [vercel()]
});

export const env = {
	..._env,
	PUBLIC_CONVEX_SITE_URL: _env.PUBLIC_CONVEX_URL.replace('.convex.cloud', '.convex.site')
};
