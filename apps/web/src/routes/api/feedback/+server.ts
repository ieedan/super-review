import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { api } from '$lib/convex/_generated/api';
import { sha256Hex, hashIp } from '$lib/server/license-token';
import type { RequestHandler } from './$types';

export const prerender = false;

const bodySchema = z.object({
	category: z.enum(['bug', 'idea', 'other']),
	title: z.string().trim().min(1).max(200),
	body: z.string().trim().min(1).max(10_000),
	email: z.string().trim().email().max(320).optional(),
	// Best-effort capture from an error toast. Every field is capped rather than
	// required: a malformed context should never cost us the report itself.
	context: z
		.object({
			action: z.string().max(200).optional(),
			tab: z.string().max(50).optional(),
			repo: z.string().max(200).optional(),
			branch: z.string().max(200).optional(),
			location: z.string().max(200).optional()
		})
		.optional(),
	appVersion: z.string().min(1),
	platform: z.string().min(1),
	osRelease: z.string().min(1),
	arch: z.string().max(30).optional(),
	electronVersion: z.string().max(30).optional()
});

/**
 * In-app feedback from the desktop app.
 *
 * Unlike the other desktop endpoints this one does NOT require a device token:
 * anyone who can open the app can file feedback, including someone whose
 * activation is exactly what's broken. A token is used when present, purely to
 * attribute the report. Abuse is handled by the rate limiter inside Convex.
 */
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'invalid_request');
	const b = parsed.data;

	const auth = request.headers.get('authorization');
	const deviceToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

	const res = await locals.convexSecret.safeMutation(api.feedback.submit, {
		category: b.category,
		title: b.title,
		body: b.body,
		email: b.email,
		context: b.context,
		appVersion: b.appVersion,
		platform: b.platform,
		osRelease: b.osRelease,
		arch: b.arch,
		electronVersion: b.electronVersion,
		deviceTokenHash: deviceToken ? sha256Hex(deviceToken) : undefined,
		ipHash: hashIp(getClientAddress())
	});

	if (res.isOk()) return json({ ok: true, id: res.value.id });

	// The desktop dialog keeps the user's typed text on a failure and shows the
	// message inline, so these map to whatever it can act on: back off, or fix
	// the input.
	const code = res.error.code;
	if (code === 'RATE_LIMITED') throw error(429, 'rate_limited');
	if (code === 'INVALID_FEEDBACK') throw error(400, 'invalid_request');
	throw error(503, 'feedback_unavailable');
};
