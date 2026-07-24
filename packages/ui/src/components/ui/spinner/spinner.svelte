<script lang="ts">
	import { cn } from '@super-review/ui/utils.js';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { SVGAttributes } from 'svelte/elements';
	import { mergeProps } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		class: className,
		role = 'status',
		// name, color, and stroke are here for compatibility with different icon
		// library prop shapes.
		name,
		color,
		stroke,
		'aria-label': ariaLabel = 'Loading',
		child,
		...restProps
	}: SVGAttributes<SVGSVGElement> & {
		// Optional: without it the component renders its own LoaderCircle (see the
		// {#if child} fallback below). Required would break every plain <Spinner />.
		child?: Snippet<[{ props: Record<string, unknown> }]>;
	} = $props();

	const mergedProps = $derived(
		mergeProps(
			{
				role,
				name: name === null ? undefined : name,
				color: color === null ? undefined : color,
				stroke: stroke === null ? undefined : stroke,
				'aria-label': ariaLabel,
				class: cn('size-4 animate-spin', className)
			},
			restProps
		)
	);
</script>

{#if child}
	{@render child({ props: mergedProps })}
{:else}
	<LoaderCircle {...mergedProps} />
{/if}
