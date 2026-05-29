<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import { useAnimations } from "$lib/hooks/use-animations.svelte";
	import type { HTMLAttributes } from "svelte/elements";

	const animations = useAnimations();

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableRowElement>> = $props();
</script>

<tr bind:this={ref} data-slot="table-row" class={cn("hover:bg-muted/50 data-[state=selected]:bg-muted border-b border-border", animations.animationsEnabled && "transition-colors", className)} {...restProps}>
	{@render children?.()}
</tr>
