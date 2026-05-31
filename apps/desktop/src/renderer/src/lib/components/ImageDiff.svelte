<script lang="ts">
	// Side-by-side image comparison, GitHub-style: the old version on the left,
	// the new on the right. Either side may be absent (an added image has no
	// old; a deleted one has no new), in which case that pane shows a "None"
	// placeholder. Used for raster images (the only view) and for the SVG
	// preview toggle. Sources are `data:` URLs produced by the main process.

	interface Props {
		oldSrc?: string;
		newSrc?: string;
		// Repo-relative path, used only for the <img> alt text.
		name: string;
		// True while the diff is still being fetched and neither side has arrived.
		loading?: boolean;
	}

	let { oldSrc, newSrc, name, loading = false }: Props = $props();

	// Natural pixel dimensions, filled in on load so each pane can label the
	// image like GitHub does. Null until the <img> reports them.
	let oldDims = $state<{ w: number; h: number } | null>(null);
	let newDims = $state<{ w: number; h: number } | null>(null);

	function onLoad(e: Event, side: 'old' | 'new'): void {
		const img = e.currentTarget as HTMLImageElement;
		const dims = { w: img.naturalWidth, h: img.naturalHeight };
		if (side === 'old') oldDims = dims;
		else newDims = dims;
	}
</script>

{#if loading && !oldSrc && !newSrc}
	<div class="p-4 text-xs text-muted-foreground">Loading image…</div>
{:else if !oldSrc && !newSrc}
	<div class="p-4 text-sm text-muted-foreground">
		Image preview unavailable — the file is too large or couldn't be read.
	</div>
{:else}
	<div class="grid gap-4 p-4 sm:grid-cols-2">
		<figure class="m-0 flex flex-col gap-2">
			<figcaption class="flex items-center gap-2 text-[10px] font-medium tracking-wide uppercase">
				<span class="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">Old</span>
				{#if oldDims}
					<span class="text-muted-foreground tabular-nums">{oldDims.w}×{oldDims.h}</span>
				{/if}
			</figcaption>
			{#if oldSrc}
				<div class="checker grid place-items-center rounded border border-border p-3">
					<img
						src={oldSrc}
						alt={`old ${name}`}
						class="max-h-[60vh] max-w-full object-contain"
						onload={(e) => onLoad(e, 'old')}
					/>
				</div>
			{:else}
				<div
					class="grid min-h-24 place-items-center rounded border border-dashed border-border text-xs text-muted-foreground"
				>
					None
				</div>
			{/if}
		</figure>

		<figure class="m-0 flex flex-col gap-2">
			<figcaption class="flex items-center gap-2 text-[10px] font-medium tracking-wide uppercase">
				<span class="rounded bg-success/15 px-1.5 py-0.5 text-success">New</span>
				{#if newDims}
					<span class="text-muted-foreground tabular-nums">{newDims.w}×{newDims.h}</span>
				{/if}
			</figcaption>
			{#if newSrc}
				<div class="checker grid place-items-center rounded border border-border p-3">
					<img
						src={newSrc}
						alt={`new ${name}`}
						class="max-h-[60vh] max-w-full object-contain"
						onload={(e) => onLoad(e, 'new')}
					/>
				</div>
			{:else}
				<div
					class="grid min-h-24 place-items-center rounded border border-dashed border-border text-xs text-muted-foreground"
				>
					None
				</div>
			{/if}
		</figure>
	</div>
{/if}

<style>
	/* Checkerboard so transparent (alpha) regions read as transparent rather
	   than blending into the surface. */
	.checker {
		background-color: #fff;
		background-image:
			linear-gradient(45deg, #e3e3e3 25%, transparent 25%),
			linear-gradient(-45deg, #e3e3e3 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #e3e3e3 75%),
			linear-gradient(-45deg, transparent 75%, #e3e3e3 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
	}
</style>
