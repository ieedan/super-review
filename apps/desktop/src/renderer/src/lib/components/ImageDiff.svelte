<script lang="ts">
	// Side-by-side image comparison, GitHub-style: the old version on the left,
	// the new on the right. When one side is absent (an added image has no old; a
	// deleted one has no new) we drop the missing pane entirely and show the
	// surviving image on its own rather than a "None" placeholder. Each image is
	// framed with CAD-style dimension rulers — a horizontal arrow for width and a
	// vertical arrow for height, each labelled with the natural pixel count. Used
	// for raster images (the only view) and for the SVG preview toggle. Sources
	// are `data:` URLs produced by the main process.

	interface Props {
		oldSrc?: string;
		newSrc?: string;
		// Repo-relative path, used only for the <img> alt text.
		name: string;
		// True while the diff is still being fetched and neither side has arrived.
		loading?: boolean;
	}

	let { oldSrc, newSrc, name, loading = false }: Props = $props();

	type Dims = { w: number; h: number };

	// Natural pixel dimensions, filled in on load so each pane can label the
	// image. Null until the <img> reports them.
	let oldDims = $state<Dims | null>(null);
	let newDims = $state<Dims | null>(null);

	// A single image (added or deleted) gets the full width; two get a column each.
	let single = $derived(!oldSrc || !newSrc);

	function onLoad(e: Event, side: 'old' | 'new'): void {
		const img = e.currentTarget as HTMLImageElement;
		const dims = { w: img.naturalWidth, h: img.naturalHeight };
		if (side === 'old') oldDims = dims;
		else newDims = dims;
	}
</script>

<!-- Horizontal (width) ruler: ←——— 120 ———→ -->
{#snippet hRuler(value: number | undefined)}
	<div class="hruler text-muted-foreground">
		<span class="head head-l"></span>
		<span class="line"></span>
		<span class="val tabular-nums">{value ?? ''}</span>
		<span class="line"></span>
		<span class="head head-r"></span>
	</div>
{/snippet}

<!-- Vertical (height) ruler, same shape rotated a quarter turn. -->
{#snippet vRuler(value: number | undefined)}
	<div class="vruler text-muted-foreground">
		<span class="head head-u"></span>
		<span class="line-v"></span>
		<span class="val tabular-nums">{value ?? ''}</span>
		<span class="line-v"></span>
		<span class="head head-d"></span>
	</div>
{/snippet}

{#snippet pane(label: string, src: string, dims: Dims | null, side: 'old' | 'new')}
	<figure class="m-0 flex w-full flex-col gap-2" class:sm:max-w-xl={single} class:mx-auto={single}>
		<!-- The Old/New badge only earns its place when both panes are shown; a
		     lone image (added or deleted) needs no label. -->
		{#if !single}
			<figcaption class="flex items-center gap-2 text-[10px] font-medium tracking-wide uppercase">
				{#if side === 'old'}
					<span class="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">{label}</span>
				{:else}
					<span class="rounded bg-success/15 px-1.5 py-0.5 text-success">{label}</span>
				{/if}
			</figcaption>
		{/if}
		<div class="measure-grid">
			<!-- top-left corner spacer -->
			<div></div>
			{@render hRuler(dims?.w)}
			{@render vRuler(dims?.h)}
			<div class="checker grid min-h-24 place-items-center rounded-sm p-3">
				<img
					{src}
					alt={`${side} ${name}`}
					class="max-h-[60vh] max-w-full object-contain"
					onload={(e) => onLoad(e, side)}
				/>
			</div>
		</div>
	</figure>
{/snippet}

{#if loading && !oldSrc && !newSrc}
	<div class="p-4 text-xs text-muted-foreground">Loading image…</div>
{:else if !oldSrc && !newSrc}
	<div class="p-4 text-sm text-muted-foreground">
		Image preview unavailable. The file is too large or couldn't be read.
	</div>
{:else}
	<div class="grid gap-4 p-4" class:sm:grid-cols-2={!single}>
		{#if oldSrc}
			{@render pane('Old', oldSrc, oldDims, 'old')}
		{/if}
		{#if newSrc}
			{@render pane('New', newSrc, newDims, 'new')}
		{/if}
	</div>
{/if}

<style>
	/* Lay the width ruler across the top and the height ruler down the left,
	   with the image filling the remaining cell. The rulers stretch to match the
	   image box on each axis. */
	.measure-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto 1fr;
		gap: 6px;
		align-items: stretch;
	}

	.hruler {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		line-height: 1;
	}
	.vruler {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		line-height: 1;
	}

	/* The rules themselves — `currentColor` so they track the muted text colour. */
	.line {
		flex: 1 1 0;
		height: 1px;
		background: currentColor;
	}
	.line-v {
		flex: 1 1 0;
		width: 1px;
		background: currentColor;
	}

	.val {
		padding: 0 1px;
	}

	/* CSS-triangle arrowheads. */
	.head {
		width: 0;
		height: 0;
	}
	.head-l {
		border-block: 3px solid transparent;
		border-right: 5px solid currentColor;
	}
	.head-r {
		border-block: 3px solid transparent;
		border-left: 5px solid currentColor;
	}
	.head-u {
		border-inline: 3px solid transparent;
		border-bottom: 5px solid currentColor;
	}
	.head-d {
		border-inline: 3px solid transparent;
		border-top: 5px solid currentColor;
	}

	/* Checkerboard so transparent (alpha) regions read as transparent rather
	   than blending into the surface. The square colours come from custom
	   properties so dark mode can swap to a low-contrast dark grid. */
	.checker {
		--checker-bg: #ffffff;
		--checker-sq: #e3e3e3;
		background-color: var(--checker-bg);
		background-image:
			linear-gradient(45deg, var(--checker-sq) 25%, transparent 25%),
			linear-gradient(-45deg, var(--checker-sq) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--checker-sq) 75%),
			linear-gradient(-45deg, transparent 75%, var(--checker-sq) 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
	}

	:global(.dark) .checker {
		--checker-bg: hsl(0 0% 11%);
		--checker-sq: hsl(0 0% 17%);
	}
</style>
