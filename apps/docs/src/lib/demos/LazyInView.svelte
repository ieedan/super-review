<script lang="ts">
	import type { Component } from 'svelte';
	import { onMount } from 'svelte';

	// Lazily loads a heavy component once it scrolls near the viewport, so the
	// embedded app components (Shiki/WASM worker, markdown stack) don't weigh down
	// the initial page load. Shows a skeleton until loaded.
	let {
		load,
		minHeight = '440px'
	}: {
		// Returns the module whose `default` export is the component to render.
		load: () => Promise<{ default: Component }>;
		minHeight?: string;
	} = $props();

	let anchor = $state<HTMLElement>();
	let Comp = $state<Component | null>(null);

	onMount(() => {
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					io.disconnect();
					void load().then((m) => (Comp = m.default));
				}
			},
			{ rootMargin: '300px' }
		);
		if (anchor) io.observe(anchor);
		return () => io.disconnect();
	});
</script>

<div bind:this={anchor}>
	{#if Comp}
		<Comp />
	{:else}
		<div
			class="border-line bg-elevated/40 flex items-center justify-center rounded-2xl border"
			style="min-height: {minHeight}"
		>
			<span class="text-faint flex items-center gap-2 font-mono text-xs">
				<span class="border-line-bright h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-flame"></span>
				Loading live demo…
			</span>
		</div>
	{/if}
</div>
