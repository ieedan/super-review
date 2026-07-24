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

/**
 * Assets on the latest published release. Throws on a non-OK response so callers
 * can map it to a 502.
 */
export async function getLatestReleaseAssets(
	token: string,
	fetcher: typeof fetch = fetch
): Promise<ReleaseAsset[]> {
	const res = await fetcher(`https://api.github.com/repos/${REPO}/releases/latest`, {
		headers: ghHeaders(token)
	});
	if (!res.ok) throw new Error(`latest release lookup failed: ${res.status}`);
	const release = (await res.json()) as { assets?: ReleaseAsset[] };
	return release.assets ?? [];
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
