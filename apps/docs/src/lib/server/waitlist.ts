import { Redis } from '@upstash/redis';
import { env } from '$env/dynamic/private';

// Upstash Redis client, created lazily from runtime env so the build (and local
// dev without credentials) never fails just because the vars aren't set. Returns
// null when unconfigured; callers degrade gracefully.
let client: Redis | null = null;
let resolved = false;

export function getRedis(): Redis | null {
	if (resolved) return client;
	resolved = true;
	const url = env.UPSTASH_REDIS_REST_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN;
	if (!url || !token) return (client = null);
	client = new Redis({ url, token });
	return client;
}

// Sorted set of signups: member = normalized email, score = signup time (ms).
// A sorted set dedupes repeat signups for free and keeps them ordered by time.
export const WAITLIST_KEY = 'waitlist';
