import { json } from '@sveltejs/kit';
import { publicJwks } from '$lib/server/license-token';
import type { RequestHandler } from './$types';

export const prerender = false;

// Public verification keys for the desktop app and future key rotation.
export const GET: RequestHandler = async () => {
	return json(await publicJwks(), {
		headers: { 'cache-control': 'public, max-age=3600' }
	});
};
