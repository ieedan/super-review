<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<!--
	Inline keyboard-shortcut hint shown next to a button's label (e.g. "Comment ⌘⏎").
	It dims via `opacity-70` against the *inherited* text color rather than a fixed
	`text-muted-foreground`, so it stays legible on any button variant — including the
	dark `primary-foreground` label over the flame gradient, where a hardcoded muted
	gray would clash.
-->
<span bind:this={ref} class={cn('ml-1 opacity-70', className)} {...restProps}>
	{@render children?.()}
</span>
