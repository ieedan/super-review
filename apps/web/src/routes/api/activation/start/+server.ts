import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { api } from '$lib/convex/_generated/api';
import {
	generateUserCode,
	formatUserCode,
	hashUserCode,
	randomToken,
	sha256Hex,
	hashIp
} from '$lib/server/license-token';
import type { RequestHandler } from './$types';

export const prerender = false;

const bodySchema = z.object({
	fingerprint: z.string().min(1),
	fingerprintSource: z.enum(['os', 'fallback']).default('os'),
	platform: z.string().min(1),
	appVersion: z.string().min(1),
	machineName: z.string().optional()
});

const MAX_COLLISION_RETRIES = 5;

// Desktop requests a device-authorization code pair. The raw device code (the
// polling secret) and user code (shown to the human) are generated here; Convex
// only ever stores their hashes.
export const POST: RequestHandler = async ({ request, url, locals, getClientAddress }) => {
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'invalid_request');
	const b = parsed.data;

	const deviceCode = randomToken(32);
	const ipHash = hashIp(getClientAddress());

	for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
		const userCode = generateUserCode();
		const res = await locals.convexSecret.safeMutation(api.activation.start, {
			userCodeHash: hashUserCode(userCode),
			deviceCodeHash: sha256Hex(deviceCode),
			fingerprint: b.fingerprint,
			fingerprintSource: b.fingerprintSource,
			machineName: b.machineName,
			platform: b.platform,
			appVersion: b.appVersion,
			ipHash
		});

		if (res.isOk()) {
			const formatted = formatUserCode(userCode);
			return json({
				deviceCode,
				userCode: formatted,
				// The code rides along in the URL so the browser can show it for the
				// user to compare against the device, no typing. The page never
				// auto-approves off it; the user still presses Confirm.
				verificationUri: `${url.origin}/activate?code=${encodeURIComponent(formatted)}`,
				expiresAt: res.value.expiresAt,
				// Desktop poll cadence; the server also caps it.
				intervalMs: 3000
			});
		}

		const code = res.error.code;
		if (code === 'ACTIVATION_CODE_COLLISION') continue; // regenerate the user code
		if (code === 'RATE_LIMITED') throw error(429, 'rate_limited');
		throw error(500, 'start_failed');
	}

	throw error(500, 'start_failed');
};
