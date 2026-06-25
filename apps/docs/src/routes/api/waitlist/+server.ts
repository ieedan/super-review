import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRedis, WAITLIST_KEY } from '$lib/server/waitlist';
import { waitlistSchema } from '$lib/schema';

// This route is a serverless function (it writes to Upstash), so it must not be
// prerendered like the marketing pages.
export const prerender = false;

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid request.' }, { status: 400 });
	}

	// Same Zod schema the client validates against — single source of truth.
	const parsed = waitlistSchema.safeParse(body);
	if (!parsed.success) {
		const error = parsed.error.issues[0]?.message ?? 'Enter a valid email address.';
		return json({ ok: false, error }, { status: 400 });
	}

	const normalized = parsed.data.email.trim().toLowerCase();
	const redis = getRedis();

	// No credentials (e.g. local dev) — accept optimistically so the UI flow can be
	// exercised, but surface it in the logs rather than silently pretending.
	if (!redis) {
		console.warn(`[waitlist] Upstash not configured; signup not persisted: ${normalized}`);
		return json({ ok: true });
	}

	try {
		await redis.zadd(WAITLIST_KEY, { score: Date.now(), member: normalized });
		return json({ ok: true });
	} catch (err) {
		console.error('[waitlist] failed to store signup', err);
		return json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
	}
};
