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
		// block so this stays a scoped, warning-free component).
		'text-muted-foreground border-border relative inline-flex h-9 w-full max-w-full items-center justify-start overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.List>
