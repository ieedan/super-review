<script lang="ts">
	import HarnessLogo from '@super-review/ui/components/HarnessLogo.svelte';
	import { AGENTS_CONVENTION_HARNESSES } from '@super-review/core/ai-config-paths';
	import { harnessLabel, type HarnessKind } from '@super-review/core/types';

	const harnesses: HarnessKind[] = [...AGENTS_CONVENTION_HARNESSES, 'claude-code'];
</script>

<section
	class="reveal border-line border-y py-10 sm:py-12"
	style="animation-delay: 400ms"
	aria-labelledby="agent-ready-heading"
>
	<p id="agent-ready-heading" class="text-faint text-center text-sm font-medium tracking-wide">
		Made agent ready for
	</p>

	<ul class="mt-7 flex flex-wrap items-center justify-center gap-24 sm:gap-[7.5rem]">
		{#each harnesses as harness (harness)}
			<li class="flex items-center">
				<span class="sr-only">{harnessLabel(harness)}</span>
				<HarnessLogo {harness} size={40} />
			</li>
		{/each}
	</ul>
</section>
