import { json, error } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { sha256Hex } from '$lib/server/license-token';
import type { RequestHandler } from './$types';

export const prerender = false;

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = request.headers.get('authorization');
	const deviceToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
	if (!deviceToken) throw error(401, 'missing_token');

	await locals.convexSecret
		.safeMutation(api.licensing.revokeDeviceToken, { tokenHash: sha256Hex(deviceToken) })
		.unwrapOr(null);

	return json({ ok: true });
};
