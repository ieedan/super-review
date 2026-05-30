<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import { cn, type WithoutChild } from '$lib/utils.js';
	import { useAnimations } from '$lib/hooks/use-animations.svelte';

	const animations = useAnimations();

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<RadioGroupPrimitive.Item
	bind:ref
	data-slot="radio-group-item"
	class={cn(
		'relative aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
		animations.animationsEnabled && 'transition-[color,box-shadow]',
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		<span
			class="pointer-events-none absolute inset-0 flex items-center justify-center"
			data-slot="radio-group-item-indicator"
		>
			{#if checked}
				<CircleIcon class="size-2 fill-primary text-primary" />
			{/if}
		</span>
	{/snippet}
</RadioGroupPrimitive.Item>
