<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';

	let { class: className = '', ...rest }: SVGAttributes<SVGSVGElement> & { class?: string } =
		$props();
</script>

<svg
	class={`size-3.5 animate-spin ${className}`}
	viewBox="0 0 16 16"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	{...rest}
>
	<circle
		cx="8"
		cy="8"
		r="7"
		stroke="currentColor"
		stroke-opacity="0.25"
		stroke-width="2"
		vector-effect="non-scaling-stroke"
	></circle>
	<path
		d="M15 8a7.002 7.002 0 0 0-7-7"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		vector-effect="non-scaling-stroke"
	></path>
</svg>
