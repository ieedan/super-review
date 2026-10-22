<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '@super-review/ui/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: TabsPrimitive.ListProps = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="underline-tabs-list"
	class={cn(
		// Horizontally scrollable when the tabs overflow, with the scrollbar hidden
		// across engines (the arbitrary utilities replace the upstream :global style
		// block so this stays a scoped, warning-free component). overflow-x-auto
		// forces overflow-y to auto too, so the bottom rule is an inset shadow
		// rather than a border: the active underline then sits inside the padding
		// box instead of poking 1px past it, which made the list scroll vertically.
		'text-muted-foreground relative inline-flex h-9 w-full max-w-full items-center justify-start overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_0_var(--color-border)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.List>
