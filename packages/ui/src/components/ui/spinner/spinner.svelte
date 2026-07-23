<script lang="ts">
	import { cn } from '@super-review/ui/utils.js';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { SVGAttributes } from 'svelte/elements';

	let {
		class: className,
		role = 'status',
		// name, color, and stroke are here for compatibility with different icon
		// library prop shapes.
		name,
		color,
		stroke,
		'aria-label': ariaLabel = 'Loading',
		...restProps
	}: SVGAttributes<SVGSVGElement> = $props();
</script>

<LoaderCircle
	{role}
	name={name === null ? undefined : name}
	color={color === null ? undefined : color}
	stroke={stroke === null ? undefined : stroke}
	aria-label={ariaLabel}
	class={cn('size-4 animate-spin', className)}
	{...restProps}
/>
