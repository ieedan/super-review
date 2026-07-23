import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { api } from '$lib/convex/_generated/api';
import { signLicenseToken, sha256Hex, randomToken, hashIp } from '$lib/server/license-token';
import type { RequestHandler } from './$types';

export const prerender = false;

const bodySchema = z.object({
	deviceCode: z.string().min(1),
	fingerprint: z.string().min(1),
	fingerprintSource: z.enum(['os', 'fallback']).default('os'),
	platform: z.string().min(1),
	appVersion: z.string().min(1),
	machineName: z.string().optional()
});

// Desktop polls with its device code until the browser side is approved or
// denied. On approval the (long-lived) device token is generated here and its
// hash handed to Convex; the license token is signed here too.
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'invalid_request');
	const b = parsed.data;

	const deviceToken = randomToken(32);

	const res = await locals.convexSecret.safeMutation(api.activation.poll, {
		deviceCodeHash: sha256Hex(b.deviceCode),
		tokenHash: sha256Hex(deviceToken),
		fingerprint: b.fingerprint,
		fingerprintSource: b.fingerprintSource,
		platform: b.platform,
		appVersion: b.appVersion,
		machineName: b.machineName,
		ipHash: hashIp(getClientAddress())
	});

	if (res.isErr()) {
		if (res.error.code === 'RATE_LIMITED') throw error(429, 'rate_limited');
		throw error(500, 'poll_failed');
	}

	const result = res.value;
	if (result.status !== 'approved') {
		return json({ status: result.status });
	}

	if (!result.decision.allowed) {
		// The device is registered but the license is not currently usable; the
		// desktop keeps its device token and can revalidate later.
		return json({
			status: 'approved',
			ok: false,
			reason: result.decision.reason,
			deviceToken,
			convexUrl: PUBLIC_CONVEX_URL
		});
	}

	const licenseToken = await signLicenseToken({
		userId: result.userId,
		licenseId: result.licenseId,
		deviceId: result.deviceId,
		plan: result.plan,
		status: result.decision.status,
		fingerprint: b.fingerprint,
		displayExpiresAt: result.decision.expiresAt,
		activeSince: result.activeSince,
		holderName: result.holder?.name ?? null,
		holderEmail: result.holder?.email ?? null,
		holderImage: result.holder?.image ?? null
	});

	return json({
		status: 'approved',
		ok: true,
		deviceToken,
		licenseToken,
		serverTime: Date.now(),
		convexUrl: PUBLIC_CONVEX_URL
	});
};
