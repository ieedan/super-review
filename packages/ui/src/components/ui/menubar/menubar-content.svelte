<script lang="ts">
	import { Menubar as MenubarPrimitive } from 'bits-ui';
	import MenubarPortal from './menubar-portal.svelte';
	import { cn, type WithoutChildrenOrChild } from '@super-review/ui/utils.js';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import type { ComponentProps } from 'svelte';

	const animations = useAnimations();

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		alignOffset = -4,
		align = 'start',
		side = 'bottom',
		portalProps,
		...restProps
	}: MenubarPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof MenubarPortal>>;
	} = $props();
</script>

<MenubarPortal {...portalProps}>
	<MenubarPrimitive.Content
		bind:ref
		data-slot="menubar-content"
		{sideOffset}
		{align}
		{alignOffset}
		{side}
		class={cn(
			'z-50 min-w-32 overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-closed:overflow-hidden',
			animations.menusEnabled &&
				'duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
			className
		)}
		{...restProps}
	/>
</MenubarPortal>
