// Fetches package metadata from the npm registry for the diff viewer's
// package.json hover cards. Runs in the main process — the renderer can't reach
// the registry directly (and even where CORS would allow it, keeping the fetch
// here means one shared cache instead of one per FileDiff section).
//
// The public registry has no field filtering, so a package document arrives
// with every version's full manifest inlined (megabytes for popular packages).
// We download it once, strip it to the handful of fields the cards render, and
// cache the trimmed result so repeated hovers are instant and free.

import type { NpmPackageInfo, NpmPackageResult } from '@shared/types.js';

const REGISTRY = 'https://registry.npmjs.org';
// How long a cached lookup stays fresh. Publish dates and the latest version
// change rarely; an hour keeps a review session from re-fetching the same
// package while still picking up new releases across sessions.
const TTL_MS = 60 * 60 * 1000;
// Abort a slow registry request rather than leaving a hover card spinning.
const FETCH_TIMEOUT_MS = 10_000;

interface CacheEntry {
	at: number;
	result: NpmPackageResult;
}

// name → cached result. Plain Map; this module is a process-wide singleton.
const cache = new Map<string, CacheEntry>();
// In-flight requests, so two hovers of the same package share one fetch.
const inflight = new Map<string, Promise<NpmPackageResult>>();

// The shape we actually read off the registry document. Everything is optional
// because the registry omits fields freely (private mirrors, sparse packages).
interface RegistryDoc {
	name?: string;
	description?: string;
	'dist-tags'?: Record<string, string>;
	time?: Record<string, string>;
	versions?: Record<string, { deprecated?: string }>;
	homepage?: string;
	repository?: string | { url?: string };
	license?: string | { type?: string };
	author?: string | { name?: string };
	keywords?: string[];
}

// Turn a repository field (string, or `{ url }` that's often `git+https://…`,
// `git+ssh://git@host/owner/repo.git`, or `git://…`) into a plain browsable
// https URL, or undefined when there's nothing usable.
function normalizeRepositoryUrl(repo: RegistryDoc['repository']): string | undefined {
	const raw = typeof repo === 'string' ? repo : repo?.url;
	if (!raw) return undefined;
	let url = raw.trim();
	url = url.replace(/^git\+/, '').replace(/\.git$/, '');
	// scp-style `git@github.com:owner/repo` → `https://github.com/owner/repo`.
	const scp = url.match(/^git@([^:]+):(.+)$/);
	if (scp) return `https://${scp[1]}/${scp[2]}`;
	if (url.startsWith('git://')) url = 'https://' + url.slice('git://'.length);
	if (url.startsWith('ssh://git@')) url = 'https://' + url.slice('ssh://git@'.length);
	if (url.startsWith('http://')) url = 'https://' + url.slice('http://'.length);
	if (!url.startsWith('https://')) return undefined;
	return url;
}

function trimDoc(doc: RegistryDoc): NpmPackageInfo {
	const latestVersion = doc['dist-tags']?.latest;

	// Collect deprecation messages — the card warns on a deprecated package. The
	// full per-version manifests can number in the thousands, so we only surface
	// the latest version's deprecation here; the card resolves the hovered
	// version against this map and falls back to latest.
	let deprecations: Record<string, string> | undefined;
	if (doc.versions) {
		for (const [version, manifest] of Object.entries(doc.versions)) {
			if (typeof manifest?.deprecated === 'string' && manifest.deprecated.length > 0) {
				(deprecations ??= {})[version] = manifest.deprecated;
			}
		}
	}

	const license = typeof doc.license === 'string' ? doc.license : doc.license?.type || undefined;
	const author = typeof doc.author === 'string' ? doc.author : doc.author?.name || undefined;

	return {
		name: doc.name ?? '',
		description: doc.description,
		latestVersion,
		homepage: doc.homepage,
		repositoryUrl: normalizeRepositoryUrl(doc.repository),
		license,
		author,
		keywords: Array.isArray(doc.keywords) ? doc.keywords.slice(0, 12) : undefined,
		// `time` is just ISO strings — small even for packages with many releases,
		// and the version card needs arbitrary versions, so keep the whole map.
		time: doc.time ?? {},
		deprecations
	};
}

// npm package names: optional `@scope/`, then a URL-safe name. Validated before
// building the request URL so a hovered token can never inject a path.
const NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

async function fetchInfo(name: string): Promise<NpmPackageResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		// Scoped names (`@scope/pkg`) must keep the `/` but encode the `@`/scope.
		const encoded = name
			.split('/')
			.map((part) => encodeURIComponent(part))
			.join('/');
		const res = await fetch(`${REGISTRY}/${encoded}`, {
			signal: controller.signal,
			headers: {
				accept: 'application/json',
				'user-agent': 'super-review (https://github.com/ieedan/super-review)'
			}
		});
		if (res.status === 404) {
			return { ok: false, error: `Package "${name}" not found on npm.` };
		}
		if (!res.ok) {
			return { ok: false, error: `npm registry returned ${res.status}.` };
		}
		const doc = (await res.json()) as RegistryDoc;
		return { ok: true, info: trimDoc(doc) };
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			return { ok: false, error: 'Timed out reaching the npm registry.' };
		}
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Could not reach the npm registry: ${message}` };
	} finally {
		clearTimeout(timer);
	}
}

export async function getNpmPackageInfo(name: string): Promise<NpmPackageResult> {
	const trimmed = name.trim();
	if (!NAME_RE.test(trimmed)) {
		return { ok: false, error: `"${name}" is not a valid npm package name.` };
	}

	const cached = cache.get(trimmed);
	if (cached && Date.now() - cached.at < TTL_MS) return cached.result;

	const existing = inflight.get(trimmed);
	if (existing) return existing;

	const promise = fetchInfo(trimmed)
		.then((result) => {
			// Cache successes, and 404s (a missing package stays missing) — but not
			// transient network/timeout errors, so the next hover retries.
			const cacheable = result.ok || /not found/.test(result.error);
			if (cacheable) cache.set(trimmed, { at: Date.now(), result });
			return result;
		})
		.finally(() => {
			inflight.delete(trimmed);
		});
	inflight.set(trimmed, promise);
	return promise;
}
