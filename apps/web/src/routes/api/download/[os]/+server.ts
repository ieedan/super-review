import { error, redirect } from '@sveltejs/kit';
import { api } from '$lib/convex/_generated/api';
import { env } from '$lib/env.server';
import { REPO, DOWNLOADS } from '$lib/releases';
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
// Note this only fixes *downloads*. electron-updater still polls the private
// repo's release feed directly (apps/desktop/electron-builder.yml `publish`),
// which 404s for installed copies; fixing that needs a `provider: generic`
// feed served from here too.

interface ReleaseAsset {
	id: number;
	name: string;
}

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
	// explains where they stand.
	const invites = await locals.convex.safeQuery(api.invites.getMine, {}).unwrapOr(null);
	if (invites && invites !== 'unauthenticated' && invites.waitlistMode && !invites.isMember) {
		throw redirect(302, '/dashboard');
	}

	const token = env.GITHUB_RELEASES_TOKEN;
	if (!token) {
		console.error('[download] GITHUB_RELEASES_TOKEN is not set');
		throw error(503, 'Downloads are temporarily unavailable. Try again in a minute.');
	}

	const headers = {
		authorization: `Bearer ${token}`,
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28'
	};

	const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
		headers
	});
	if (!releaseRes.ok) {
		console.error(`[download] latest release lookup failed: ${releaseRes.status}`);
		throw error(502, 'Downloads are temporarily unavailable. Try again in a minute.');
	}

	const release = (await releaseRes.json()) as { assets?: ReleaseAsset[] };
	const filename = DOWNLOADS[os].filename;
	const asset = release.assets?.find((a) => a.name === filename);
	if (!asset) {
		console.error(`[download] no asset named ${filename} on the latest release`);
		throw error(404, 'That build is not published yet.');
	}

	// `Accept: application/octet-stream` turns the asset endpoint into a 302 to
	// a signed URL. `redirect: 'manual'` stops fetch following it so we can hand
	// the location to the browser instead of streaming the file ourselves.
	const assetRes = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`, {
		headers: { ...headers, accept: 'application/octet-stream' },
		redirect: 'manual'
	});
	const location = assetRes.headers.get('location');
	if (!location) {
		console.error(`[download] asset ${asset.id} returned no location (${assetRes.status})`);
		throw error(502, 'Downloads are temporarily unavailable. Try again in a minute.');
	}

	throw redirect(302, location);
};
