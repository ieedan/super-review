<script lang="ts">
	import { Menubar as MenubarPrimitive } from 'bits-ui';
	import { cn } from '@super-review/ui/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: MenubarPrimitive.RootProps = $props();
</script>

<MenubarPrimitive.Root
	bind:ref
	data-slot="menubar"
	class={cn('flex h-full items-center gap-0 bg-transparent p-0', className)}
	{...restProps}
/>
