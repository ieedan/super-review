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

	<ul
		class="mt-7 flex w-full flex-nowrap items-center justify-between gap-1 px-2 sm:justify-center sm:gap-[clamp(1.5rem,7vw,7.5rem)] sm:px-0"
	>
		{#each harnesses as harness, i (harness)}
			<li class="reveal flex shrink-0 items-center" style="animation-delay: {480 + i * 80}ms">
				<span class="sr-only">{harnessLabel(harness)}</span>
				<span class="sm:hidden">
					<HarnessLogo {harness} size={28} />
				</span>
				<span class="hidden sm:inline-flex">
					<HarnessLogo {harness} size={40} />
				</span>
			</li>
		{/each}
	</ul>
</section>
