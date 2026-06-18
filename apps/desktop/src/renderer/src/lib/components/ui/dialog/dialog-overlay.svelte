<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import { useAnimations } from '$lib/hooks/use-animations.svelte';

	const animations = useAnimations();

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	class={cn(
		'fixed inset-0 isolate z-50 bg-black/50',
		animations.menusEnabled &&
			'duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
		className
	)}
	{...restProps}
/>
