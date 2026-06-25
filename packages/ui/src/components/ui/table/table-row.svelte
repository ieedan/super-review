<script lang="ts">
	import { cn, type WithElementRef } from '@super-review/ui/utils.js';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	const animations = useAnimations();

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableRowElement>> = $props();
</script>

<tr
	bind:this={ref}
	data-slot="table-row"
	class={cn(
		'border-b border-border hover:bg-muted/50 data-[state=selected]:bg-muted',
		animations.accentsEnabled && 'transition-colors',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tr>
