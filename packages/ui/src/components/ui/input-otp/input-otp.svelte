<script lang="ts">
	import { PinInput, type WithoutChildrenOrChild } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { cn } from '@super-review/ui/utils.js';

	// The per-cell data bits-ui hands to the children snippet. Typed inline to
	// avoid depending on a bits-ui internal type name.
	type CellData = { char?: string | null; isActive: boolean; hasFakeCaret: boolean };

	let {
		ref = $bindable(null),
		value = $bindable(''),
		class: className,
		children: renderCells,
		...restProps
	}: WithoutChildrenOrChild<PinInput.RootProps> & {
		children: Snippet<[{ cells: CellData[] }]>;
	} = $props();
</script>

<PinInput.Root
	bind:value
	bind:ref
	class={cn('flex items-center gap-2 has-disabled:opacity-50', className)}
	{...restProps}
>
	{#snippet children({ cells })}
		{@render renderCells({ cells })}
	{/snippet}
</PinInput.Root>
