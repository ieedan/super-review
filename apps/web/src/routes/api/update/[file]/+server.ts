import { error, redirect } from '@sveltejs/kit';
import {
	assetSignedUrl,
	assetText,
	findDesktopReleaseAsset,
	releasesToken
} from '$lib/server/github-releases';
import type { RequestHandler } from './$types';

export const prerender = false;

// electron-updater's generic update feed for the desktop app. The releases repo
// is private, so installed copies can't poll GitHub's release feed directly;
// the app points electron-updater here instead (apps/desktop/src/main/
// updater.ts sets provider: generic, url: <site>/api/update).
//
// Two kinds of request come through:
//   * `latest-mac.yml` / `latest.yml` — the small update manifests. We return
//     their *bytes* so electron-updater resolves the artifacts they name back
//     through THIS origin (relative to the feed URL), not github.com. They're a
//     few hundred bytes, so serving them through the function is cheap.
//   * the installer / blockmap the manifest names — we 302 to GitHub's
//     short-lived signed object URL, exactly like /api/download/[os], so the
//     ~100MB binary never streams through this function.
//
// Deliberately public (no auth): electron-updater runs with no session, and the
// installers are license-gated inside the app anyway. Differential downloads
// are disabled on the client (see updater.ts), so only the manifest + one full
// artifact are ever requested per update.

// electron-updater only ever asks for the manifest files and named release
// artifacts. Allow letters, digits, spaces (the mac zip's product name has
// them), and . _ - so nothing exotic reaches the GitHub API. The [file] route
// param can't contain a slash, so path traversal isn't possible regardless.
const SAFE_FILE = /^[A-Za-z0-9 ._-]+$/;

const UNAVAILABLE = 'Updates are temporarily unavailable.';

export const GET: RequestHandler = async ({ params, setHeaders }) => {
	const file = params.file;
	if (!SAFE_FILE.test(file)) throw error(404, 'Not found');

	const token = releasesToken();
	if (!token) {
		console.error('[update] GITHUB_RELEASES_TOKEN is not set');
		throw error(503, UNAVAILABLE);
	}

	let asset;
	try {
		asset = await findDesktopReleaseAsset(token, file);
	} catch (e) {
		console.error(`[update] ${(e as Error).message}`);
		throw error(502, UNAVAILABLE);
	}
	if (!asset) throw error(404, 'Not found');

	// Manifests: serve the bytes from this origin so artifact URLs resolve back
	// through this route. no-store, or a cached manifest would pin clients to an
	// old version.
	if (file.endsWith('.yml')) {
		let body: string;
		try {
			body = await assetText(token, asset.id);
		} catch (e) {
			console.error(`[update] ${(e as Error).message}`);
			throw error(502, UNAVAILABLE);
		}
		setHeaders({ 'content-type': 'text/yaml; charset=utf-8', 'cache-control': 'no-store' });
		return new Response(body);
	}

	// Installer / blockmap: hand off GitHub's signed URL and stay out of the byte
	// path.
	let location: string | null;
	try {
		location = await assetSignedUrl(token, asset.id);
	} catch (e) {
		console.error(`[update] ${(e as Error).message}`);
		throw error(502, UNAVAILABLE);
	}
	if (!location) {
		console.error(`[update] asset ${asset.id} returned no signed URL`);
		throw error(502, UNAVAILABLE);
	}
	throw redirect(302, location);
};
