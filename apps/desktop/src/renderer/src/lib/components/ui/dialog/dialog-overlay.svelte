<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import { useAnimations } from "$lib/hooks/use-animations.svelte";

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
	class={cn("bg-black/10 supports-backdrop-filter:backdrop-blur-xs fixed inset-0 isolate z-50", animations.animationsEnabled && "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 duration-100", className)}
	{...restProps}
/>
