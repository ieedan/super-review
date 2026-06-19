<script lang="ts">
	// Recreates the desktop app's package.json hover card: hover a dependency name
	// in the diff and a popover fetches npm metadata + GitHub release notes. Here
	// the data is baked in, but the hover-intent timing, the layout, the badges and
	// the collapsible "What's new" changelog all mirror PackageHoverCard.svelte.

	type Release = { tag: string; body: string };
	type Pkg = {
		name: string;
		version: string;
		description: string;
		latest: string;
		published: string;
		license: string;
		keywords: string[];
		homepage: string;
		repo: string;
		glyph: string;
		releases: Release[];
	};

	const PACKAGES: Record<string, Pkg> = {
		svelte: {
			name: 'svelte',
			version: '^5.16.6',
			description: 'Cybernetically enhanced web apps.',
			latest: '5.22.4',
			published: '3 days ago',
			license: 'MIT',
			keywords: ['UI', 'framework', 'reactive', 'compiler', 'web'],
			homepage: 'svelte.dev',
			repo: 'github.com/sveltejs/svelte',
			glyph: '🔥',
			releases: [
				{
					tag: 'svelte@5.22.4',
					body: '- Fix `bind:` to component exports inside `{#snippet}`\n- Improve hydration mismatch warnings\n- Reduce generated code size for `{#each}` blocks'
				},
				{
					tag: 'svelte@5.20.0',
					body: '- Add `$state.snapshot` deep-clone fast path\n- Support `await` in `$derived`'
				}
			]
		},
		vite: {
			name: 'vite',
			version: '^8.0.7',
			description: 'Native-ESM powered web dev build tool.',
			latest: '8.1.0',
			published: '1 week ago',
			license: 'MIT',
			keywords: ['build', 'dev-server', 'esm', 'rollup', 'frontend'],
			homepage: 'vite.dev',
			repo: 'github.com/vitejs/vite',
			glyph: '⚡',
			releases: [
				{
					tag: 'v8.1.0',
					body: '- Faster cold starts via parallelized dependency scanning\n- `server.warmup` now accepts glob patterns\n- Drop legacy CJS entry'
				}
			]
		},
		tailwindcss: {
			name: 'tailwindcss',
			version: '^4.2.2',
			description: 'A utility-first CSS framework for rapid UI development.',
			latest: '4.2.4',
			published: '5 days ago',
			license: 'MIT',
			keywords: ['css', 'utility', 'design', 'oxide', 'framework'],
			homepage: 'tailwindcss.com',
			repo: 'github.com/tailwindlabs/tailwindcss',
			glyph: '🌬️',
			releases: [
				{
					tag: 'v4.2.4',
					body: '- Fix `@source` resolution on Windows\n- Faster incremental rebuilds with the Oxide engine'
				}
			]
		},
		typescript: {
			name: 'typescript',
			version: '^5.7.3',
			description: 'TypeScript is a language for application-scale JavaScript.',
			latest: '5.8.2',
			published: '2 weeks ago',
			license: 'Apache-2.0',
			keywords: ['types', 'javascript', 'compiler', 'language'],
			homepage: 'typescriptlang.org',
			repo: 'github.com/microsoft/TypeScript',
			glyph: '🟦',
			releases: [
				{
					tag: 'v5.8.2',
					body: '- Support `using` declarations in more positions\n- Smarter narrowing for indexed access types'
				}
			]
		}
	};

	const OPEN_DELAY = 280;
	const HIDE_DELAY = 140;

	let activeKey = $state<string | null>(null);
	let cardLeft = $state(0);
	// Either `top` (open below) or `bottom` (open above) is set; the other stays
	// null so only one anchor is applied. Mirrors the app preferring above.
	let cardTop = $state<number | null>(null);
	let cardBottom = $state<number | null>(null);
	let expanded = $state(false);
	let container = $state<HTMLElement>();

	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	const active = $derived(activeKey ? PACKAGES[activeKey] : null);

	function scheduleOpen(key: string, el: HTMLElement) {
		clearTimeout(hideTimer);
		clearTimeout(openTimer);
		openTimer = setTimeout(() => {
			if (!container) return;
			const c = container.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			const cardWidth = 320;
			let left = r.left - c.left;
			left = Math.min(left, container.clientWidth - cardWidth - 12);
			left = Math.max(12, left);
			cardLeft = left;
			// Prefer opening above the token (like the app); flip below when there
			// isn't enough headroom for the card to sit above the line.
			const spaceAbove = r.top - c.top;
			if (spaceAbove > 280) {
				cardBottom = container.clientHeight - (r.top - c.top) + 8;
				cardTop = null;
			} else {
				cardTop = r.bottom - c.top + 8;
				cardBottom = null;
			}
			expanded = false;
			activeKey = key;
		}, OPEN_DELAY);
	}

	function scheduleHide() {
		clearTimeout(openTimer);
		if (expanded) return; // pinned open while changelog is expanded
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => (activeKey = null), HIDE_DELAY);
	}

	function keepOpen() {
		clearTimeout(hideTimer);
	}

	// The package.json source, with dependency tokens flagged for hover wiring.
	const lines: { indent: number; pre?: string; pkg?: string; post?: string; plain?: string }[] = [
		{ indent: 0, plain: '{' },
		{ indent: 1, plain: '"name": "@super-review/docs",' },
		{ indent: 1, plain: '"type": "module",' },
		{ indent: 1, plain: '"dependencies": {' },
		{ indent: 2, pre: '"', pkg: 'svelte', post: '": "^5.16.6",' },
		{ indent: 2, pre: '"', pkg: 'vite', post: '": "^8.0.7",' },
		{ indent: 2, pre: '"', pkg: 'tailwindcss', post: '": "^4.2.2",' },
		{ indent: 2, pre: '"', pkg: 'typescript', post: '": "^5.7.3"' },
		{ indent: 1, plain: '}' },
		{ indent: 0, plain: '}' }
	];
</script>

<!-- The outer wrapper is the positioning context for the hover card and is NOT
     clipped, so the card (and its expanded changelog) can float past the panel
     edges like the real popover. The rounded window chrome lives on the inner
     wrapper, which clips only the source. -->
<div bind:this={container} class="relative text-left">
	<div
		class="border-line bg-elevated/85 overflow-hidden rounded-2xl shadow-2xl backdrop-blur-sm"
	>
		<!-- Window chrome -->
		<div class="border-line flex items-center gap-2 border-b px-4 py-3">
			<span class="h-3 w-3 rounded-full bg-[hsl(2_78%_63%)]"></span>
			<span class="h-3 w-3 rounded-full bg-[hsl(38_92%_60%)]"></span>
			<span class="h-3 w-3 rounded-full bg-[hsl(142_58%_52%)]"></span>
			<span class="text-faint ml-3 font-mono text-xs">package.json</span>
			<span class="text-faint ml-auto font-mono text-[11px]">hover a dependency ↓</span>
		</div>

		<!-- Source -->
		<div class="overflow-x-auto px-2 py-4 font-mono text-[13px] leading-7">
		{#each lines as line, i (i)}
			<div class="flex">
				<span class="text-faint w-8 shrink-0 pr-3 text-right select-none">{i + 1}</span>
				<code class="whitespace-pre">{'  '.repeat(line.indent)}{#if line.pkg}{line.pre}<button
							type="button"
							class="cursor-help rounded-sm text-flame underline decoration-dotted decoration-flame/60 underline-offset-4 transition-colors hover:bg-flame/10 hover:text-flame-soft"
							onpointerenter={(e) => scheduleOpen(line.pkg!, e.currentTarget)}
							onpointerleave={scheduleHide}
							onfocus={(e) => scheduleOpen(line.pkg!, e.currentTarget)}
							onblur={scheduleHide}>{line.pkg}</button>{line.post}{:else}<span class="text-dim">{line.plain}</span>{/if}</code>
			</div>
		{/each}
		</div>
	</div>

	<!-- Hover card -->
	{#if active}
		<div
			role="tooltip"
			class="border-line-bright bg-base/95 absolute z-30 w-80 rounded-xl border p-0 shadow-2xl backdrop-blur-md"
			style="{cardTop !== null ? `top: ${cardTop}px;` : ''} {cardBottom !== null
				? `bottom: ${cardBottom}px;`
				: ''} left: {cardLeft}px; box-shadow: 0 30px 80px -28px hsl(6 88% 40% / 0.5);"
			onpointerenter={keepOpen}
			onpointerleave={scheduleHide}
		>
			<!-- Header -->
			<div class="flex items-start gap-2.5 px-3.5 pt-3.5">
				<span class="text-lg leading-none">{active.glyph}</span>
				<div class="min-w-0 flex-1">
					<a
						href="https://www.npmjs.com/package/{active.name}"
						target="_blank"
						rel="noreferrer"
						class="text-fg hover:text-flame inline-flex items-center gap-1 font-display text-sm font-bold transition-colors"
					>
						{active.name}
						{@render extLink()}
					</a>
				</div>
			</div>

			<!-- Body -->
			<div class="border-line mt-3 border-t px-3.5 pt-3 pb-3.5">
				<p class="text-dim text-[12.5px] leading-relaxed">{active.description}</p>

				<div class="mt-3 flex flex-wrap gap-1.5">
					<span
						class="inline-flex items-center gap-1 rounded-md bg-[hsl(199_89%_58%/0.15)] px-2 py-0.5 text-[11px] font-medium text-[hsl(199_89%_72%)]"
					>
						<span class="opacity-70">latest</span>
						{active.latest}
					</span>
					<span
						class="border-line text-faint inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
					>
						{@render clock()}
						{active.published}
					</span>
					<span
						class="border-line text-faint inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
					>
						{active.license}
					</span>
				</div>

				<div class="text-faint mt-2.5 truncate font-mono text-[10.5px]">
					{active.keywords.join(' · ')}
				</div>

				<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
					<a
						href="https://{active.homepage}"
						target="_blank"
						rel="noreferrer"
						class="text-flame hover:text-flame-soft inline-flex items-center gap-1"
					>
						Homepage {@render extLink()}
					</a>
					<a
						href="https://{active.repo}"
						target="_blank"
						rel="noreferrer"
						class="text-flame hover:text-flame-soft inline-flex items-center gap-1"
					>
						Repository {@render extLink()}
					</a>
				</div>

				<!-- Changelog disclosure -->
				<div class="border-line mt-3 border-t pt-3">
					<button
						type="button"
						onclick={() => (expanded = !expanded)}
						class="text-dim hover:text-fg flex w-full items-center gap-1.5 text-[12px] font-medium transition-colors"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="h-3.5 w-3.5 transition-transform {expanded ? 'rotate-90' : ''}"
						>
							<path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						What's new in {active.latest}
					</button>

					{#if expanded}
						<div class="bg-elevated/70 mt-2.5 max-h-48 overflow-y-auto rounded-lg p-3">
							{#each active.releases as rel (rel.tag)}
								<div class="mb-3 last:mb-0">
									<div class="text-flame mb-1 font-mono text-[11px] font-semibold">{rel.tag}</div>
									<div class="text-dim text-[12px] leading-relaxed whitespace-pre-line">
										{rel.body}
									</div>
								</div>
							{/each}
						</div>
						<a
							href="https://{active.repo}/releases"
							target="_blank"
							rel="noreferrer"
							class="text-flame hover:text-flame-soft mt-2 inline-flex items-center gap-1 text-[11.5px]"
						>
							Full changelog {@render extLink()}
						</a>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

{#snippet extLink()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3">
		<path
			d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
{/snippet}

{#snippet clock()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3">
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3 2" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
{/snippet}
