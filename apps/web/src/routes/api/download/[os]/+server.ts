import { error, redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { DOWNLOADS } from '$lib/releases';
import { isWaitlistBlocked } from '$lib/entitlement';
import { assetSignedUrl, getLatestReleaseAssets, releasesToken } from '$lib/server/github-releases';
import type { RequestHandler } from './$types';

export const prerender = false;

// The release repo is private, so the public
// `releases/latest/download/<name>` endpoint 404s for everyone except users
// with repo access. This route stands in for it: it checks the visitor is
// signed in, resolves the newest release asset with a server-side token, and
// 302s to GitHub's short-lived signed object URL.
//
// The redirect matters. GitHub's signed URL serves the binary directly with
// `Content-Disposition: attachment`, so the bytes never pass through this
// server and we don't pay for the bandwidth or hold a serverless function open
// for the length of a ~100MB download.
//
// This handles manual downloads; installed copies get their updates from the
// sibling /api/update feed, which proxies the same private assets for
// electron-updater. Both share $lib/server/github-releases.

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const os = params.os;
	if (os !== 'mac' && os !== 'windows') throw error(404, 'Unknown download');

	// Auth-gated, not license-gated: new accounts download the app precisely so
	// they can start their trial in it, and the app enforces licensing itself.
	const user = await locals.convex.safeQuery(api.auth.getCurrentUser, {}).unwrapOr(null);
	if (!user) throw redirect(302, `/login?next=${encodeURIComponent(url.pathname)}`);

	// Beta gate. Resolves to allowed whenever waitlist mode is off, so this is
	// inert after launch. Handing the binary to someone who can't activate it
	// would just be a confusing dead end, so bounce them to the dashboard, which
	// explains where they stand. Closed when the query fails: the user is known
	// to be signed in by here, so no answer means Convex is unreachable, and the
	// wrong guess would serve private release binaries to anyone with an account.
	const invites = await locals.convex.safeQuery(api.invites.getMine, {}).unwrapOr(null);
	if (isWaitlistBlocked(invites)) {
		throw redirect(302, '/dashboard');
	}

	const token = releasesToken();
	if (!token) {
		console.error('[download] GITHUB_RELEASES_TOKEN is not set');
		throw error(503, 'Downloads are temporarily unavailable. Try again in a minute.');
	}

	const filename = DOWNLOADS[os].filename;
	let asset;
	try {
		const assets = await getLatestReleaseAssets(token);
		asset = assets.find((a) => a.name === filename);
	} catch (e) {
		console.error(`[download] ${(e as Error).message}`);
		throw error(502, 'Downloads are temporarily unavailable. Try again in a minute.');
	}
	if (!asset) {
		console.error(`[download] no asset named ${filename} on the latest release`);
		throw error(404, 'That build is not published yet.');
	}

	const location = await assetSignedUrl(token, asset.id);
	if (!location) {
		console.error(`[download] asset ${asset.id} returned no signed URL`);
		throw error(502, 'Downloads are temporarily unavailable. Try again in a minute.');
	}

	throw redirect(302, location);
};
