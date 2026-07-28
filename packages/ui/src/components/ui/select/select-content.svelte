<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import SelectPortal from './select-portal.svelte';
	import { cn, type WithoutChild, type WithoutChildrenOrChild } from '@super-review/ui/utils.js';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import type { ComponentProps } from 'svelte';

	const animations = useAnimations();

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = 'start',
		portalProps,
		children,
		preventScroll = true,
		...restProps
	}: WithoutChild<SelectPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SelectPortal>>;
	} = $props();
</script>

<SelectPortal {...portalProps}>
	<SelectPrimitive.Content
		bind:ref
		{sideOffset}
		{align}
		{preventScroll}
		data-slot="select-content"
		class={cn(
			'bg-popover text-popover-foreground ring-foreground/10 relative z-50 max-h-(--bits-select-content-available-height) min-w-(--bits-select-anchor-width) origin-(--bits-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg shadow-md ring-1 outline-none data-closed:overflow-hidden',
			animations.menusEnabled &&
				'duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</SelectPrimitive.Content>
</SelectPortal>
