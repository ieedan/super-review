<script lang="ts">
	// Mounts the REAL PackageHoverCard from @super-review/ui and drives its shared
	// controller by hand — in the app, Pierre fires these same showPackageHover /
	// scheduleHidePackageHover calls from token-hover events inside the diff.
	// Lazily loaded by PackageHoverDemo so the markdown/Shiki stack stays out of
	// the initial bundle.
	import {
		PackageHoverCard,
		showPackageHover,
		scheduleHidePackageHover,
		setNpmProvider,
		type PackageHoverTarget
	} from '@super-review/ui';
	import { fixtureNpmProvider } from './npm-fixtures';

	// Serve the card baked-in npm/GitHub data instead of IPC.
	setNpmProvider(fixtureNpmProvider);

	// package.json dependency rows. `bump` carries an old→new range so that entry
	// demonstrates the "what changed X → Y" range changelog; the rest hover as a
	// single current version.
	type Dep = { name: string; range: string; oldRange?: string };
	const deps: Dep[] = [
		{ name: 'svelte', range: '^5.22.4', oldRange: '^5.16.6' },
		{ name: 'vite', range: '^8.0.7' },
		{ name: 'tailwindcss', range: '^4.2.2' },
		{ name: 'typescript', range: '^5.7.3' }
	];

	function targetFor(dep: Dep): PackageHoverTarget {
		return {
			kind: 'name',
			name: dep.name,
			version: dep.range,
			oldRange: dep.oldRange ?? dep.range,
			newRange: dep.range
		};
	}

	const indent = '  ';
</script>

<div class="sr-surface dark border-line overflow-hidden rounded-2xl border shadow-2xl">
	<div class="flex items-center gap-2 border-b border-border px-4 py-3">
		<span class="h-3 w-3 rounded-full bg-[hsl(2_78%_63%)]"></span>
		<span class="h-3 w-3 rounded-full bg-[hsl(38_92%_60%)]"></span>
		<span class="h-3 w-3 rounded-full bg-[hsl(142_58%_52%)]"></span>
		<span class="ml-3 font-mono text-xs text-muted-foreground">package.json</span>
		<span class="ml-auto font-mono text-[11px] text-muted-foreground">hover a dependency</span>
	</div>

	<div class="overflow-x-auto px-2 py-4 font-mono text-[13px] leading-7 text-foreground">
		<div class="flex"><span class="w-8 shrink-0 pr-3 text-right text-muted-foreground select-none">1</span><code>&lbrace;</code></div>
		<div class="flex"><span class="w-8 shrink-0 pr-3 text-right text-muted-foreground select-none">2</span><code>{indent}"dependencies": &lbrace;</code></div>
		{#each deps as dep, i (dep.name)}
			<div class="flex">
				<span class="w-8 shrink-0 pr-3 text-right text-muted-foreground select-none">{i + 3}</span>
				<code class="whitespace-pre">{indent}{indent}"<button
						type="button"
						class="rounded-sm text-primary hover:bg-primary/10"
						onpointerenter={(e) => showPackageHover(e.currentTarget, targetFor(dep))}
						onpointerleave={scheduleHidePackageHover}
						onfocus={(e) => showPackageHover(e.currentTarget, targetFor(dep))}
						onblur={scheduleHidePackageHover}>{dep.name}</button>": "<span class="text-muted-foreground">{dep.range}</span>"{i < deps.length - 1 ? ',' : ''}</code>
			</div>
		{/each}
		<div class="flex"><span class="w-8 shrink-0 pr-3 text-right text-muted-foreground select-none">{deps.length + 3}</span><code>{indent}&rbrace;</code></div>
		<div class="flex"><span class="w-8 shrink-0 pr-3 text-right text-muted-foreground select-none">{deps.length + 4}</span><code>&rbrace;</code></div>
	</div>
</div>

<!-- The real shared card; the controller above anchors it to the hovered token. -->
<PackageHoverCard themeType="dark" />
