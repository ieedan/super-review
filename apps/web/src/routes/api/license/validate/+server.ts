import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$lib/env.server';
import { api } from '$lib/convex/_generated/api';
import { signLicenseToken, sha256Hex, hashIp } from '$lib/server/license-token';
import type { RequestHandler } from './$types';

export const prerender = false;

const bodySchema = z.object({
	fingerprint: z.string().min(1),
	platform: z.string().min(1),
	appVersion: z.string().min(1)
});

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const auth = request.headers.get('authorization');
	const deviceToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
	if (!deviceToken) throw error(401, 'missing_token');

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'invalid_request');
	const b = parsed.data;

	const result = await locals.convexSecret
		.safeMutation(api.licensing.validateDevice, {
			tokenHash: sha256Hex(deviceToken),
			fingerprint: b.fingerprint,
			platform: b.platform,
			appVersion: b.appVersion,
			ipHash: hashIp(getClientAddress())
		})
		.unwrapOr(null);

	if (!result) throw error(503, 'validation_unavailable');

	if (!result.ok) {
		// Definitive server verdict. The desktop treats these ONLY as lock
		// signals - never as unlock (that requires a signed token). `convexUrl` is
		// still returned so a locked app can open the realtime watch and unlock the
		// instant the user buys, without waiting for the next poll.
		return json({ ok: false, reason: result.reason, convexUrl: env.PUBLIC_CONVEX_URL });
	}

	const licenseToken = await signLicenseToken({
		userId: result.userId,
		licenseId: result.licenseId,
		deviceId: result.deviceId,
		plan: result.plan,
		status: result.status,
		fingerprint: b.fingerprint,
		displayExpiresAt:
			result.plan === 'lifetime' ? null : (result.currentPeriodEnd ?? result.trialEndsAt),
		activeSince: result.activeSince,
		holderName: result.holder?.name ?? null,
		holderEmail: result.holder?.email ?? null,
		holderImage: result.holder?.image ?? null
	});

	return json({ ok: true, licenseToken, serverTime: Date.now(), convexUrl: env.PUBLIC_CONVEX_URL });
};
