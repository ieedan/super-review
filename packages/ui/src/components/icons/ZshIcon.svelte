<script lang="ts">
	interface Props {
		class?: string;
	}
	let { class: className = '' }: Props = $props();
</script>

<svg
	class={className}
	viewBox="0 0 24 24"
	xmlns="http://www.w3.org/2000/svg"
	aria-hidden="true"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	<rect x="2.5" y="4" width="19" height="16" rx="2.5" />
	<path d="M6.5 9 9.5 12 6.5 15" />
	<path d="M11.5 15.5h5" />
</svg>
