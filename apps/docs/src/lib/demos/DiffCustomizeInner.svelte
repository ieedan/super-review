<script lang="ts">
	// Mounts the REAL diff components from @super-review/ui — DiffStylePreview
	// (the actual @pierre/diffs renderer the app uses) and FileListPreview — and
	// drives them with the app's real theme list. Loaded lazily by
	// DiffCustomizeDemo so the Shiki/WASM worker only downloads on scroll.
	import { DiffStylePreview, FileListPreview, DIFF_THEMES, diffThemePair } from '@super-review/ui';

	const FONTS = [
		{ id: 'system', label: 'System', stack: "ui-monospace, 'SF Mono', Menlo, Monaco, monospace" },
		{ id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', monospace" },
		{ id: 'fira', label: 'Fira Code', stack: "'Fira Code', monospace" }
	];

	let themeType = $state<'light' | 'dark'>('dark');
	let diffThemeId = $state('pierre');
	let fontId = $state('system');
	let viewMode = $state<'split' | 'unified'>('split');
	let showIcons = $state(true);

	const themePair = $derived(diffThemePair(diffThemeId));
	const font = $derived(FONTS.find((f) => f.id === fontId)!);
</script>

<div class="grid gap-6 lg:grid-cols-[260px_1fr]">
	<!-- Controls -->
	<div class="border-line bg-elevated/60 flex flex-col gap-5 rounded-2xl border p-5">
		{@render segmented('Theme mode', themeType, [
			{ id: 'dark', label: 'Dark' },
			{ id: 'light', label: 'Light' }
		], (v) => (themeType = v as 'light' | 'dark'))}

		<div>
			<div class="text-faint mb-2 text-[11px] font-semibold tracking-wide uppercase">Syntax theme</div>
			<div class="grid grid-cols-2 gap-2">
				{#each DIFF_THEMES as t (t.id)}
					{@const pairName = themeType === 'dark' ? t.dark : t.light}
					<button
						type="button"
						onclick={() => (diffThemeId = t.id)}
						class="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors {diffThemeId ===
						t.id
							? 'border-flame text-fg'
							: 'border-line text-dim hover:border-line-bright'}"
						title={pairName}
					>
						<span class="bg-flame/70 h-3 w-3 shrink-0 rounded-full"></span>
						{t.label}
					</button>
				{/each}
			</div>
		</div>

		{@render segmented('View', viewMode, [
			{ id: 'split', label: 'Split' },
			{ id: 'unified', label: 'Unified' }
		], (v) => (viewMode = v as 'split' | 'unified'))}

		<div>
			<div class="text-faint mb-2 text-[11px] font-semibold tracking-wide uppercase">Code font</div>
			<div class="flex flex-col gap-1.5">
				{#each FONTS as f (f.id)}
					<button
						type="button"
						onclick={() => (fontId = f.id)}
						class="flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs transition-colors {fontId ===
						f.id
							? 'border-flame text-fg'
							: 'border-line text-dim hover:border-line-bright'}"
						style="font-family: {f.stack}"
					>
						{f.label}
						{#if fontId === f.id}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3.5 w-3.5 text-flame">
								<path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<label class="flex cursor-pointer items-center justify-between">
			<span class="text-fg text-sm font-medium">File icons</span>
			<button
				type="button"
				role="switch"
				aria-label="Toggle file icons"
				aria-checked={showIcons}
				onclick={() => (showIcons = !showIcons)}
				class="relative h-6 w-11 shrink-0 rounded-full transition-colors {showIcons
					? 'bg-flame'
					: 'bg-line-bright'}"
			>
				<span
					class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform {showIcons
						? 'translate-x-5'
						: ''}"
				></span>
			</button>
		</label>
	</div>

	<!-- Live preview — the REAL app components -->
	<div
		class="sr-surface overflow-hidden rounded-2xl border border-border shadow-2xl {themeType ===
		'dark'
			? 'dark'
			: ''}"
		style="--code-font: {font.stack}"
	>
		<div class="flex min-h-[420px]">
			<aside class="hidden w-52 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-2 sm:flex">
				<div class="px-2 py-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
					Changes
				</div>
				<FileListPreview layout="tree" {showIcons} />
			</aside>

			<div class="min-w-0 flex-1 overflow-x-auto p-4">
				<div class="mb-3 font-mono text-xs text-muted-foreground">greet.js</div>
				<DiffStylePreview mode={viewMode} theme={themePair} {themeType} />
			</div>
		</div>
	</div>
</div>

{#snippet segmented(
	label: string,
	value: string,
	options: { id: string; label: string }[],
	set: (v: string) => void
)}
	<div>
		<div class="text-faint mb-2 text-[11px] font-semibold tracking-wide uppercase">{label}</div>
		<div class="border-line bg-base/50 flex gap-1 rounded-lg border p-1">
			{#each options as opt (opt.id)}
				<button
					type="button"
					onclick={() => set(opt.id)}
					class="flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors {value === opt.id
						? 'bg-elevated text-fg shadow'
						: 'text-dim hover:text-fg'}"
				>
					{opt.label}
				</button>
			{/each}
		</div>
	</div>
{/snippet}
