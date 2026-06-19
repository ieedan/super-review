// Static npm/GitHub fixtures backing the marketing site's package.json hover
// demo. In the desktop app this data comes from the main process over IPC; here
// an NpmProvider serves baked-in metadata so the REAL PackageHoverCard renders
// without any network access.
import type { NpmProvider } from '@super-review/ui';
import type { NpmPackageInfo, ReleaseNotes } from '@super-review/ui';

// A date `days` ago, as an ISO string — keeps the card's relative times ("3
// days ago") sensible whenever the page is viewed.
function daysAgo(days: number): string {
	return new Date(Date.now() - days * 86_400_000).toISOString();
}

const PACKAGES: Record<string, NpmPackageInfo> = {
	svelte: {
		name: 'svelte',
		description: 'Cybernetically enhanced web apps.',
		latestVersion: '5.22.4',
		homepage: 'https://svelte.dev',
		repositoryUrl: 'https://github.com/sveltejs/svelte',
		license: 'MIT',
		keywords: ['UI', 'framework', 'reactive', 'compiler', 'web'],
		time: { '5.16.6': daysAgo(96), '5.22.4': daysAgo(3) }
	},
	vite: {
		name: 'vite',
		description: 'Native-ESM powered web dev build tool.',
		latestVersion: '8.1.0',
		homepage: 'https://vite.dev',
		repositoryUrl: 'https://github.com/vitejs/vite',
		license: 'MIT',
		keywords: ['build', 'dev-server', 'esm', 'rollup', 'frontend'],
		time: { '8.0.7': daysAgo(21), '8.1.0': daysAgo(7) }
	},
	tailwindcss: {
		name: 'tailwindcss',
		description: 'A utility-first CSS framework for rapid UI development.',
		latestVersion: '4.2.4',
		homepage: 'https://tailwindcss.com',
		repositoryUrl: 'https://github.com/tailwindlabs/tailwindcss',
		license: 'MIT',
		keywords: ['css', 'utility', 'design', 'oxide', 'framework'],
		time: { '4.2.2': daysAgo(12), '4.2.4': daysAgo(5) }
	},
	typescript: {
		name: 'typescript',
		description: 'TypeScript is a language for application-scale JavaScript.',
		latestVersion: '5.8.2',
		homepage: 'https://www.typescriptlang.org',
		repositoryUrl: 'https://github.com/microsoft/TypeScript',
		license: 'Apache-2.0',
		keywords: ['types', 'javascript', 'compiler', 'language'],
		time: { '5.7.3': daysAgo(40), '5.8.2': daysAgo(14) }
	}
};

// Release notes keyed by `${name}@${version}`. Markdown bodies render through the
// card's real GFM pipeline (marked + DOMPurify + Shiki).
const RELEASES: Record<string, ReleaseNotes> = {
	'svelte@5.22.4': {
		tag: 'svelte@5.22.4',
		htmlUrl: 'https://github.com/sveltejs/svelte/releases/tag/svelte%405.22.4',
		publishedAt: daysAgo(3),
		body: '### Patch Changes\n\n- Fix `bind:` to component exports inside `{#snippet}`\n- Improve hydration mismatch warnings\n- Reduce generated code size for `{#each}` blocks'
	},
	'svelte@5.20.0': {
		tag: 'svelte@5.20.0',
		htmlUrl: 'https://github.com/sveltejs/svelte/releases/tag/svelte%405.20.0',
		publishedAt: daysAgo(34),
		body: '### Minor Changes\n\n- Add `$state.snapshot` deep-clone fast path\n- Support `await` in `$derived`'
	},
	'vite@8.0.7': {
		tag: 'v8.0.7',
		htmlUrl: 'https://github.com/vitejs/vite/releases/tag/v8.0.7',
		publishedAt: daysAgo(21),
		body: '- Faster cold starts via parallelized dependency scanning\n- `server.warmup` now accepts glob patterns'
	},
	'tailwindcss@4.2.2': {
		tag: 'v4.2.2',
		htmlUrl: 'https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.2.2',
		publishedAt: daysAgo(12),
		body: '- Fix `@source` resolution on Windows\n- Faster incremental rebuilds with the Oxide engine'
	},
	'typescript@5.7.3': {
		tag: 'v5.7.3',
		htmlUrl: 'https://github.com/microsoft/TypeScript/releases/tag/v5.7.3',
		publishedAt: daysAgo(40),
		body: '- Support `using` declarations in more positions\n- Smarter narrowing for indexed access types'
	}
};

export const fixtureNpmProvider: NpmProvider = {
	async getPackageInfo(name) {
		const info = PACKAGES[name];
		return info ? { ok: true, info } : { ok: false, error: `No data for ${name}.` };
	},
	async getReleaseNotes(_repo, packageName, version) {
		return { ok: true, release: RELEASES[`${packageName}@${version}`] ?? null };
	},
	async getReleaseNotesRange(_repo, packageName, from, to) {
		// Every fixture release for this package strictly above `from`, up to `to`.
		const releases = Object.entries(RELEASES)
			.filter(([key]) => key.startsWith(`${packageName}@`))
			.map(([, r]) => r)
			.filter((r) => {
				const v = r.tag.replace(/^[^@]*@?v?/, '');
				return v > from && v <= to;
			})
			.sort((a, b) => (a.publishedAt! < b.publishedAt! ? 1 : -1));
		return { ok: true, releases, truncated: false };
	}
};
