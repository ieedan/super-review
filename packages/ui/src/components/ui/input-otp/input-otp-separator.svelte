<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { WithElementRef } from 'bits-ui';
	import MinusIcon from '@lucide/svelte/icons/minus';

	let {
		ref = $bindable(null),
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div bind:this={ref} role="separator" {...restProps}>
	{#if children}
		{@render children()}
	{:else}
		<MinusIcon class="text-muted-foreground size-4" />
	{/if}
</div>
