// The data boundary for the package.json hover card. In the desktop app the
// fetch happens in the main process over IPC (window.api.npm); other hosts (the
// marketing site) inject their own implementation — a direct registry fetch or
// static fixtures. The card's reactive caches (npm-info / release-notes) call
// through whatever provider the host installs.

import type {
	NpmPackageResult,
	ReleaseNotesResult,
	ReleaseNotesRangeResult
} from '@super-review/core/types';

export interface NpmProvider {
	getPackageInfo(name: string): Promise<NpmPackageResult>;
	getReleaseNotes(
		repositoryUrl: string,
		packageName: string,
		version: string
	): Promise<ReleaseNotesResult>;
	getReleaseNotesRange(
		repositoryUrl: string,
		packageName: string,
		from: string,
		to: string
	): Promise<ReleaseNotesRangeResult>;
}

let provider: NpmProvider | null = null;

/** Install the data source the hover card fetches through. Call once at boot. */
export function setNpmProvider(p: NpmProvider): void {
	provider = p;
}

/** The installed provider, or a no-op that reports the missing wiring. */
export function getNpmProvider(): NpmProvider {
	return provider ?? FALLBACK;
}

const FALLBACK: NpmProvider = {
	getPackageInfo: async () => ({ ok: false, error: 'No npm provider configured.' }),
	getReleaseNotes: async () => ({ ok: true, release: null }),
	getReleaseNotesRange: async () => ({ ok: true, releases: [], truncated: false })
};
