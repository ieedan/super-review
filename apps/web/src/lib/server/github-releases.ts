// Server-side helpers for resolving assets on the (private) desktop releases
// repo. The repo is private, so GitHub's public
// `releases/latest/download/<name>` endpoint 404s for everyone without access.
// A server-side token (GITHUB_RELEASES_TOKEN, read scope) lets us resolve the
// latest release and hand out GitHub's short-lived signed object URLs instead.
//
// Shared by the auth-gated manual downloads (/api/download/[os]) and the
// electron-updater feed (/api/update/[file]). Server-only: never import from a
// module that also runs in the browser, or the token handling ships to clients.

import { env } from '$lib/env.server';
import { REPO } from '$lib/releases';

export interface ReleaseAsset {
	id: number;
	name: string;
}

/** The GitHub releases token, or null when it isn't configured. */
export function releasesToken(): string | null {
	return env.GITHUB_RELEASES_TOKEN ?? null;
}

function ghHeaders(token: string): Record<string, string> {
	return {
		authorization: `Bearer ${token}`,
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28'
	};
}

// Desktop releases are tagged `v<semver>` by the release workflow (see
// .github/workflows/release.yml). They are NOT the only releases in this repo:
// changesets publishes one per npm package too, named `<pkg>@<version>` (e.g.
// `super-review@0.0.9`). GitHub's `releases/latest` returns whichever is newest
// overall, so the first CLI publish silently took over the update feed and the
// download links — it carries no installers or `latest*.yml`, so every lookup
// 404'd. Match the desktop tag shape instead of trusting `latest`. Prereleases
// count: the beta line ships through this same feed.
const DESKTOP_TAG = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

// How far back to look. Generous enough to skip a run of CLI-only releases
// without paginating; releases older than this are long superseded anyway.
const RELEASE_PAGE_SIZE = 50;

/**
 * The newest desktop release asset with the given name, or null when no recent
 * desktop release carries it. Throws on a non-OK response so callers can map it
 * to a 502.
 *
 * Resolved per asset rather than per release: if a build partially fails (or
 * artifacts land on separate releases, as they did during the duplicate-draft
 * race) the platform whose artifacts are missing falls back to the last release
 * that has them, instead of 404ing the whole feed. electron-updater compares
 * versions itself, so an older manifest reads as "no update" — never a
 * downgrade.
 */
export async function findDesktopReleaseAsset(
	token: string,
	name: string,
	fetcher: typeof fetch = fetch
): Promise<ReleaseAsset | null> {
	const res = await fetcher(
		`https://api.github.com/repos/${REPO}/releases?per_page=${RELEASE_PAGE_SIZE}`,
		{ headers: ghHeaders(token) }
	);
	if (!res.ok) throw new Error(`release list lookup failed: ${res.status}`);
	const releases = (await res.json()) as Array<{
		tag_name?: string;
		draft?: boolean;
		published_at?: string | null;
		created_at?: string | null;
		assets?: ReleaseAsset[];
	}>;
	// Sorted here rather than trusting the API's order, which is not recency for a
	// repo holding more than one release series: the CLI's `super-review@0.0.9`
	// comes back *after* a desktop release published an hour earlier. Take the
	// most recently published desktop release first.
	const desktop = releases
		// A draft's assets aren't public yet — the publish step flips it live.
		.filter((r) => !r.draft && DESKTOP_TAG.test(r.tag_name ?? ''))
		.sort((a, b) => releaseTime(b) - releaseTime(a));
	for (const release of desktop) {
		const asset = release.assets?.find((a) => a.name === name);
		if (asset) return asset;
	}
	return null;
}

// When a release went live. `published_at` is null only while a release is still
// a draft, which is filtered out above; `created_at` is the fallback, and 0 sinks
// anything with neither rather than letting it sort to the front.
function releaseTime(release: {
	published_at?: string | null;
	created_at?: string | null;
}): number {
	const stamp = release.published_at ?? release.created_at;
	const time = stamp ? Date.parse(stamp) : Number.NaN;
	return Number.isNaN(time) ? 0 : time;
}

/**
 * GitHub's short-lived signed object URL for a release asset. `Accept:
 * application/octet-stream` turns the asset endpoint into a 302; `redirect:
 * 'manual'` stops fetch following it so we can hand the location on. Returns
 * null when GitHub doesn't send a Location (i.e. something went wrong).
 */
export async function assetSignedUrl(
	token: string,
	assetId: number,
	fetcher: typeof fetch = fetch
): Promise<string | null> {
	const res = await fetcher(`https://api.github.com/repos/${REPO}/releases/assets/${assetId}`, {
		headers: { ...ghHeaders(token), accept: 'application/octet-stream' },
		redirect: 'manual'
	});
	return res.headers.get('location');
}

/**
 * The raw text body of a (small) release asset — used for the update-manifest
 * files (latest*.yml). Follows the signed URL and reads it out. Throws on any
 * failure.
 */
export async function assetText(
	token: string,
	assetId: number,
	fetcher: typeof fetch = fetch
): Promise<string> {
	const location = await assetSignedUrl(token, assetId, fetcher);
	if (!location) throw new Error(`asset ${assetId} returned no signed URL`);
	const res = await fetcher(location);
	if (!res.ok) throw new Error(`asset ${assetId} body fetch failed: ${res.status}`);
	return res.text();
}
