<script lang="ts">
	// Mounts the REAL package.json diff renderer (PackageJsonDiff → @pierre/diffs
	// FileDiff with the app's token-hover detection) and the REAL PackageHoverCard.
	// Hovering a dependency in the rendered diff fires the same showPackageHover
	// path the desktop app uses; the card's data comes from a fixture NpmProvider.
	// Lazily loaded by PackageHoverDemo so the markdown/Shiki stack stays out of
	// the initial bundle.
	import { PackageJsonDiff, PackageHoverCard, setNpmProvider } from '@super-review/ui';
	import { fixtureNpmProvider } from './npm-fixtures';

	setNpmProvider(fixtureNpmProvider);

	// A real package.json before/after — `svelte` is bumped so hovering it shows
	// the "what changed" range changelog; the others hover as a single version.
	const OLD = `{
  "name": "@acme/web",
  "type": "module",
  "dependencies": {
    "svelte": "^5.16.6",
    "vite": "^8.0.7",
    "tailwindcss": "^4.2.2",
    "typescript": "^5.7.3"
  }
}
`;

	const NEW = `{
  "name": "@acme/web",
  "type": "module",
  "dependencies": {
    "svelte": "^5.22.4",
    "vite": "^8.0.7",
    "tailwindcss": "^4.2.2",
    "typescript": "^5.7.3"
  }
}
`;
</script>

<div class="sr-surface dark overflow-hidden rounded-2xl border border-border shadow-2xl">
	<div class="flex items-center gap-2 border-b border-border px-4 py-3">
		<span class="h-3 w-3 rounded-full bg-[hsl(2_78%_63%)]"></span>
		<span class="h-3 w-3 rounded-full bg-[hsl(38_92%_60%)]"></span>
		<span class="h-3 w-3 rounded-full bg-[hsl(142_58%_52%)]"></span>
		<span class="ml-3 font-mono text-xs text-muted-foreground">package.json</span>
		<span class="ml-auto font-mono text-[11px] text-muted-foreground">hover a dependency</span>
	</div>
	<div class="p-2">
		<PackageJsonDiff oldContents={OLD} newContents={NEW} mode="unified" themeType="dark" />
	</div>
</div>

<!-- The real shared card; the diff above drives it via the package-hover controller. -->
<PackageHoverCard themeType="dark" />
