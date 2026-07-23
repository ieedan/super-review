<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		reverse = false,
		textDelay,
		demoDelay,
		demo
	}: {
		title: string;
		description: string;
		reverse?: boolean;
		textDelay?: string;
		demoDelay?: string;
		demo: Snippet;
	} = $props();

	const layoutClass = $derived(
		reverse
			? 'flex flex-col items-center gap-8 lg:flex-row-reverse lg:items-start lg:gap-12'
			: 'flex flex-col items-center gap-8 lg:flex-row lg:items-start lg:gap-12'
	);
	const textAlignClass = $derived(
		reverse ? 'text-center lg:text-right' : 'text-center lg:text-left'
	);
</script>

<div class={layoutClass}>
	<div
		class="reveal flex-1 {textAlignClass}"
		style={textDelay ? `animation-delay: ${textDelay}` : undefined}
	>
		<h3 class="font-display text-2xl font-bold tracking-tight">{title}</h3>
		<p class="text-muted-foreground mt-3 text-base leading-relaxed text-pretty">
			{description}
		</p>
	</div>
	<div
		class="reveal w-full lg:w-[600px] lg:shrink-0"
		style={demoDelay ? `animation-delay: ${demoDelay}` : undefined}
	>
		{@render demo()}
	</div>
</div>
