<script lang="ts">
	import HarnessLogo from './HarnessLogo.svelte';
	import { AGENTS_CONVENTION_HARNESSES } from '@super-review/core/ai-config-paths';

	// A small 2x2 collage of the agent logos the `.agents` convention covers. Used
	// in place of a generic folder icon so the `.agents` row visibly represents the
	// group of agents it configures (Cursor, Codex, opencode, GitHub Copilot).
	let { size = 22, class: className = '' }: { size?: number; class?: string } = $props();

	const gap = 1;
	// Each logo sits in one quadrant of the box, minus the inter-cell gap.
	const cell = $derived((size - gap) / 2);
</script>

<div
	class={`grid shrink-0 grid-cols-2 place-items-center ${className}`}
	style={`width:${size}px;height:${size}px;gap:${gap}px`}
	aria-hidden="true"
>
	{#each AGENTS_CONVENTION_HARNESSES as harness (harness)}
		<HarnessLogo {harness} size={cell} />
	{/each}
</div>
