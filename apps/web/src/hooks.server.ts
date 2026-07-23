import { env } from '$lib/env.server';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { SafeConvexClient, SecretClient } from '$lib/convex.svelte';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { withServerConvexToken } from 'convex-svelte/sveltekit/server';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

/** Seconds of validity below which a JWT is treated as already dead: it could
 * expire between now and the Convex queries this request will run. */
const JWT_MIN_REMAINING_MS = 30_000;

function jwtRemainingMs(token: string): number {
	try {
		const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as {
			exp?: number;
		};
		return payload.exp ? payload.exp * 1000 - Date.now() : 0;
	} catch {
		return 0;
	}
}

function getSessionCookie(cookies: import('@sveltejs/kit').Cookies): string | undefined {
	return (
		cookies.get('__Secure-better-auth.session_token') ?? cookies.get('better-auth.session_token')
	);
}

/**
 * The Convex JWT cookie only lives as long as the JWT itself (15 minutes),
 * while the better-auth session cookie lasts for days. Once the JWT cookie
 * expires, every SSR pass would look signed-out: auth-guarded pages bounce to
 * /login and soft-auth data vanishes until the client refreshes the token,
 * which reads as the dashboard "flashing away and back". When the session is
 * still alive, mint a fresh JWT server-side (the same /convex/token endpoint
 * the client uses) and re-set the cookie so SSR stays authenticated.
 */
async function refreshConvexJwt(event: Parameters<Handle>[0]['event']): Promise<string | null> {
	try {
		const res = await fetch(`${env.PUBLIC_CONVEX_SITE_URL}/api/auth/convex/token`, {
			headers: { cookie: event.request.headers.get('cookie') ?? '' }
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { token?: string };
		if (!body.token) return null;
		const secure = event.url.protocol === 'https:';
		const remaining = jwtRemainingMs(body.token);
		event.cookies.set(
			secure ? '__Secure-better-auth.convex_jwt' : 'better-auth.convex_jwt',
			body.token,
			{
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure,
				maxAge: Math.max(60, Math.floor(remaining / 1000))
			}
		);
		return body.token;
	} catch {
		// Convex being unreachable must not take down SSR; the client-side
		// auth flow will retry.
		return null;
	}
}

const withToken: Handle = async ({ event, resolve }) => {
	let token: string | undefined | null = getToken(event.cookies);
	if (token && jwtRemainingMs(token) < JWT_MIN_REMAINING_MS) token = null;
	if (!token && getSessionCookie(event.cookies)) {
		token = await refreshConvexJwt(event);
	}
	event.locals.token = token ?? undefined;
	return withServerConvexToken(token ?? undefined, () => resolve(event));
};

const injectConvex: Handle = async ({ event, resolve }) => {
	event.locals.convex = new SafeConvexClient(createConvexHttpClient());
	event.locals.convexSecret = new SecretClient(createConvexHttpClient(), env.FUNCTION_SECRET);

	return resolve(event);
};

export const handle = sequence(withToken, injectConvex);
