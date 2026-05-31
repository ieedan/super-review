<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';

	let { class: className = '', ...rest }: SVGAttributes<SVGSVGElement> & { class?: string } =
		$props();
</script>

<!--
	GitHub's "in progress" check status icon: an amber ring with a solid dot in
	the center. Only the gapped ring spins; the dot stays centered. Color comes
	from currentColor so callers set the amber via class.
-->
<svg
	class={`size-3.5 ${className}`}
	viewBox="0 0 16 16"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	{...rest}
>
	<circle cx="8" cy="8" r="2" fill="currentColor"></circle>
	<g class="origin-center animate-spin">
		<circle
			cx="8"
			cy="8"
			r="6"
			stroke="currentColor"
			stroke-opacity="0.3"
			stroke-width="2"
		></circle>
		<path
			d="M8 2a6 6 0 0 1 6 6"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		></path>
	</g>
</svg>
