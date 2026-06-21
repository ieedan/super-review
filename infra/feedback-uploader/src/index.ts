/**
 * Feedback upload broker — a Cloudflare Worker that stores screenshots and screen
 * recordings attached to in-app feedback into an R2 bucket and returns a public
 * URL the desktop app embeds in the GitHub issue it files.
 *
 * GitHub's REST API can't accept media on an issue (only the web UI can), so the
 * desktop app POSTs each attachment here first. We don't want to ship R2 secrets
 * in a desktop client, so this Worker holds them and gates uploads on the user's
 * own GitHub token: it calls GitHub's `/user` to confirm the caller is a real,
 * authenticated GitHub user before accepting bytes. The token is only verified,
 * never stored.
 *
 *   POST /upload
 *     Authorization: Bearer <github-oauth-token>
 *     Content-Type:  image/png | image/jpeg | ... | video/mp4 | ...
 *     X-Filename:    <url-encoded original filename>   (optional)
 *     body:          raw file bytes
 *     → 200 { "url": "https://.../feedback/2026/<uuid>.png" }
 *
 *   GET /feedback/<key>
 *     Serves the stored object (used when no custom bucket domain is configured).
 */

// Cloudflare's native per-Worker rate-limiting binding (configured under
// [[ratelimit]] in wrangler.toml). Declared locally so we don't depend on the
// exact @cloudflare/workers-types version exposing it.
interface RateLimit {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
	// R2 bucket binding (see wrangler.toml).
	FEEDBACK_BUCKET: R2Bucket;
	// Sliding-window limiter applied to uploads, keyed by client IP (see
	// wrangler.toml [[ratelimit]]). Caps how fast any one source can POST.
	UPLOAD_RATE_LIMIT: RateLimit;
	// KV namespace holding per-user daily usage counters. Optional: when absent the
	// daily quota is simply not enforced (the Worker still runs). Wire it up by
	// creating a namespace and binding it in wrangler.toml.
	FEEDBACK_QUOTA?: KVNamespace;
	// Public origin objects are served from. When set (a custom domain or the
	// bucket's r2.dev URL) returned URLs point there; otherwise they point back at
	// this Worker's GET route. No trailing slash.
	PUBLIC_BASE_URL?: string;
	// Optional overrides; default to the desktop app's own limits.
	MAX_IMAGE_BYTES?: string;
	MAX_VIDEO_BYTES?: string;
	// Optional per-user/day quota overrides (used only when FEEDBACK_QUOTA is set).
	MAX_FILES_PER_DAY?: string;
	MAX_BYTES_PER_DAY?: string;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

// Per-GitHub-user daily caps (enforced only when the FEEDBACK_QUOTA KV binding is
// present — see wrangler.toml). Bounds total cost from a single authenticated
// user dripping uploads under the rate limit. Overridable via vars.
const DEFAULT_MAX_FILES_PER_DAY = 50;
const DEFAULT_MAX_BYTES_PER_DAY = 250 * 1024 * 1024; // 250 MB/user/day

const EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'video/mp4': 'mp4',
	'video/webm': 'webm',
	'video/quicktime': 'mov'
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
	});
}

// Resolve the bearer token to its GitHub user. We don't authorize against any
// particular permission — anyone with a valid GitHub identity may file feedback —
// we only stop anonymous abuse and get a stable id to meter per-user quota by.
// Returns null when the token is missing or invalid. The id comes from GitHub's
// response for this token, so it can't be spoofed by the caller.
async function authenticateGithub(auth: string | null): Promise<{ id: string } | null> {
	if (!auth?.startsWith('Bearer ')) return null;
	const token = auth.slice('Bearer '.length).trim();
	if (!token) return null;
	const res = await fetch('https://api.github.com/user', {
		headers: {
			authorization: `Bearer ${token}`,
			'user-agent': 'super-review-feedback-uploader',
			accept: 'application/vnd.github+json'
		}
	});
	if (!res.ok) return null;
	const user = (await res.json()) as { id?: number | string };
	if (user.id == null) return null;
	return { id: String(user.id) };
}

interface DailyUsage {
	files: number;
	bytes: number;
}

// Check the caller's usage for today and, if this upload fits, reserve it by
// incrementing the counter. Returns false when the daily file-count or byte cap
// would be exceeded. No-op (always allows) when the KV binding isn't configured,
// so the Worker still runs before the namespace is wired up. KV is eventually
// consistent, so this is a soft cap — fine for a cost guardrail.
async function checkAndReserveQuota(env: Env, userId: string, addBytes: number): Promise<boolean> {
	if (!env.FEEDBACK_QUOTA) return true;
	const maxFiles = Number(env.MAX_FILES_PER_DAY) || DEFAULT_MAX_FILES_PER_DAY;
	const maxBytes = Number(env.MAX_BYTES_PER_DAY) || DEFAULT_MAX_BYTES_PER_DAY;
	const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
	const key = `quota:${userId}:${day}`;
	const current = ((await env.FEEDBACK_QUOTA.get(key, 'json')) as DailyUsage | null) ?? {
		files: 0,
		bytes: 0
	};
	if (current.files + 1 > maxFiles || current.bytes + addBytes > maxBytes) return false;
	const next: DailyUsage = { files: current.files + 1, bytes: current.bytes + addBytes };
	// TTL past end of day so the key self-cleans; a fresh day starts at zero.
	await env.FEEDBACK_QUOTA.put(key, JSON.stringify(next), { expirationTtl: 60 * 60 * 48 });
	return true;
}

function maxBytesFor(env: Env, mimeType: string): number {
	if (VIDEO_TYPES.has(mimeType)) return Number(env.MAX_VIDEO_BYTES) || DEFAULT_MAX_VIDEO_BYTES;
	return Number(env.MAX_IMAGE_BYTES) || DEFAULT_MAX_IMAGE_BYTES;
}

// Read the body while enforcing `max`, aborting the stream the moment it's
// exceeded so a client that omits or lies about Content-Length still can't make
// us buffer more than the cap. Returns null when the limit is breached.
async function readLimited(request: Request, max: number): Promise<ArrayBuffer | null> {
	// Cheap pre-reject on the declared length when present and honest.
	const declared = Number(request.headers.get('content-length'));
	if (declared && declared > max) return null;
	if (!request.body) return new ArrayBuffer(0);

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out.buffer;
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
	// Rate-limit by source IP FIRST — before the GitHub round-trip — so a flood of
	// bogus tokens can't amplify into a GitHub request (and cost) per attempt.
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	const { success } = await env.UPLOAD_RATE_LIMIT.limit({ key: `upload:${ip}` });
	if (!success) {
		return json({ error: 'Too many uploads — slow down and try again shortly.' }, 429);
	}

	const user = await authenticateGithub(request.headers.get('authorization'));
	if (!user) {
		return json({ error: 'Unauthorized' }, 401);
	}

	const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim();
	if (!IMAGE_TYPES.has(contentType) && !VIDEO_TYPES.has(contentType)) {
		return json({ error: `Unsupported content type: ${contentType || '(none)'}` }, 415);
	}

	const max = maxBytesFor(env, contentType);
	const bytes = await readLimited(request, max);
	if (!bytes) {
		return json({ error: 'File too large' }, 413);
	}

	// Daily per-user cap (no-op unless FEEDBACK_QUOTA is bound). Checked after the
	// per-file read so we meter the real byte count, before we store anything.
	if (!(await checkAndReserveQuota(env, user.id, bytes.byteLength))) {
		return json({ error: 'Daily upload limit reached. Try again tomorrow.' }, 429);
	}

	const ext = EXTENSIONS[contentType] ?? 'bin';
	const year = new Date().getUTCFullYear();
	const key = `feedback/${year}/${crypto.randomUUID()}.${ext}`;

	await env.FEEDBACK_BUCKET.put(key, bytes, {
		httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' }
	});

	const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? new URL(request.url).origin;
	return json({ url: `${base}/${key}` });
}

async function handleGet(key: string, env: Env): Promise<Response> {
	const object = await env.FEEDBACK_BUCKET.get(key);
	if (!object) return new Response('Not found', { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('cache-control', 'public, max-age=31536000, immutable');
	headers.set('access-control-allow-origin', '*');
	return new Response(object.body, { headers });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'access-control-allow-origin': '*',
					'access-control-allow-methods': 'GET, POST, OPTIONS',
					'access-control-allow-headers': 'authorization, content-type, x-filename'
				}
			});
		}

		if (request.method === 'POST' && url.pathname === '/upload') {
			try {
				return await handleUpload(request, env);
			} catch (err) {
				return json({ error: err instanceof Error ? err.message : 'Upload failed' }, 500);
			}
		}

		// Reads are deliberately NOT IP-rate-limited: GitHub renders issue images
		// through its camo proxy, so all viewers' fetches arrive from a small pool of
		// GitHub IPs — limiting by IP would throttle everyone at once. Egress is free
		// on R2 and the immutable cache headers let camo/browsers cache, so reads
		// aren't a meaningful cost vector.
		if (request.method === 'GET' && url.pathname.startsWith('/feedback/')) {
			return handleGet(url.pathname.slice(1), env);
		}

		if (request.method === 'GET' && url.pathname === '/') {
			return new Response('super-review feedback uploader', { status: 200 });
		}

		return new Response('Not found', { status: 404 });
	}
};
