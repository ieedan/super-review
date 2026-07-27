<script lang="ts">
	import { Menubar as MenubarPrimitive } from 'bits-ui';
	import { cn } from '@super-review/ui/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		inset,
		...restProps
	}: MenubarPrimitive.GroupHeadingProps & {
		inset?: boolean;
	} = $props();
</script>

<MenubarPrimitive.GroupHeading
	bind:ref
	data-slot="menubar-group-heading"
	data-inset={inset}
	class={cn('px-2 py-1.5 text-xs font-semibold data-[inset]:ps-8', className)}
	{...restProps}
/>
