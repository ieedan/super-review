<script lang="ts">
	import { seedStore } from './store-harness';

	// Seeds the global `app` store (and anything else, e.g. the diff cache) before
	// the wrapped component mounts. `setup` runs synchronously in this component's
	// init, which Svelte executes before the children snippet renders — so the
	// target component sees the seeded state from its very first read. Switching
	// stories in Storybook re-creates this wrapper, so each story re-seeds from a
	// clean slate. Pass a `frame` to give store-driven components the bounded
	// pane they expect instead of overflowing the canvas.
	let {
		setup,
		frame = true,
		width = '900px',
		height = '600px',
		children
	}: {
		setup?: () => void;
		frame?: boolean;
		width?: string;
		height?: string;
		children?: import('svelte').Snippet;
	} = $props();

	// Reset-then-seed up front (even with no setup) so no prior story bleeds in.
	if (setup) setup();
	else seedStore();
</script>

{#if frame}
	<div
		class="overflow-hidden rounded-lg border border-border bg-background"
		style="width: {width}; height: {height};"
	>
		{@render children?.()}
	</div>
{:else}
	{@render children?.()}
{/if}
