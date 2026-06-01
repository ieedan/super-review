// Direct, always-latest download links for the Super Review desktop app.
//
// The release artifacts use *stable, version-less* filenames (configured in
// apps/desktop/electron-builder.yml via dmg.artifactName / nsis.artifactName):
//   macOS (Apple silicon): Super-Review-mac-arm64.dmg
//   Windows (x64):         Super-Review-win-x64.exe
//
// GitHub's `releases/latest/download/<name>` endpoint 302-redirects to the
// newest release's matching asset and serves it with `Content-Disposition:
// attachment`, so a plain link *downloads the binary directly* — no API call, no
// version lookup, always the latest. It also works for authenticated visitors
// while the repo is private (the unauthenticated REST API is CORS-blocked and
// 404s for private repos, which is why we don't rely on it here).

export const REPO = 'ieedan/super-review';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;

export type OS = 'mac' | 'windows' | 'other';

export interface Download {
	os: 'mac' | 'windows';
	label: string;
	arch: string;
	/** Stable asset filename (also used as the `download` attribute hint). */
	filename: string;
	/** Direct link that resolves to the latest release's asset. */
	url: string;
}

const FILENAME: Record<'mac' | 'windows', string> = {
	mac: 'Super-Review-mac-arm64.dmg',
	windows: 'Super-Review-win-x64.exe'
};

function build(os: 'mac' | 'windows', label: string, arch: string): Download {
	return {
		os,
		label,
		arch,
		filename: FILENAME[os],
		url: `${RELEASES_URL}/latest/download/${FILENAME[os]}`
	};
}

export const DOWNLOADS: Record<'mac' | 'windows', Download> = {
	mac: build('mac', 'macOS', 'Apple silicon'),
	windows: build('windows', 'Windows', 'x64')
};

/** Best-effort OS sniff. Arch is implied by the OS (mac = arm64, win = x64). */
export function detectOS(): OS {
	if (typeof navigator === 'undefined') return 'other';
	const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
	const platform = (uaData?.platform || navigator.platform || '').toLowerCase();
	const ua = (navigator.userAgent || '').toLowerCase();
	if (platform.includes('mac') || ua.includes('mac')) return 'mac';
	if (platform.includes('win') || ua.includes('win')) return 'windows';
	return 'other';
}

/**
 * Best-effort latest version string for display only (e.g. the "v0.0.5" pill).
 * Downloads never depend on this — it returns null when the API is unreachable,
 * rate-limited, or 404s because the repo is private.
 */
export async function fetchLatestVersion(fetcher: typeof fetch = fetch): Promise<string | null> {
	try {
		const res = await fetcher(`https://api.github.com/repos/${REPO}/releases/latest`, {
			headers: { Accept: 'application/vnd.github+json' }
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { tag_name?: string };
		return data.tag_name?.replace(/^v/, '') || null;
	} catch {
		return null;
	}
}
