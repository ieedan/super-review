<script lang="ts">
	// The waiting state for a commit-message run: the agent that is working, and a
	// line that rolls through what it is doing.
	//
	// The phases are not observable — a CLI can stay silent for its entire run —
	// so they advance on a timer and settle on the last one rather than looping.
	// Going back to "Reading everything over" after "Writing" would read as the
	// run starting over.
	import HarnessLogo from './HarnessLogo.svelte';
	import { effectiveCommitMessageHarness } from '@super-review/ui/store.svelte';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import { cn } from '@super-review/ui/utils';

	const PHASES = [
		'Looking everything over...',
		'Reading the changes...',
		'Finding what matters...',
		'Summarizing...',
		'Checking the details...',
		'Verifying...',
		'Drafting the message...',
		'Writing your commit...'
	];
	// Long enough to read the line before it moves on.
	const HOLD_MS = 1800;

	const animations = useAnimations();
	const harness = $derived(effectiveCommitMessageHarness());

	let phase = $state(0);

	// Re-runs on each advance and schedules the next; stops on the last phase.
	$effect(() => {
		if (phase >= PHASES.length - 1) return;
		const timer = setTimeout(() => (phase += 1), HOLD_MS);
		return () => clearTimeout(timer);
	});
</script>

<!-- The row arrives with the run rather than snapping in: it is the first thing
     the sparkle produces, and a hard cut reads as a layout glitch next to the
     tokens that follow it. -->
<span
	class={cn(
		'flex min-w-0 items-center gap-2',
		animations.accentsEnabled && 'animate-stream-status'
	)}
>
	{#if harness}
		<HarnessLogo {harness} size={14} class="shrink-0" />
	{/if}
	<!-- One line tall with the phases stacked inside it: moving the stack up by
	     whole lines is the scroll. It steps in `lh`, not percentages — a
	     percentage translate is relative to the stack's own height, which walks
	     the whole list off screen in one go. `1lh` also keeps the window on
	     whatever line-height the field it is painted over resolves to. -->
	<span class="block h-[1lh] min-w-0 flex-1 overflow-hidden">
		<span
			class={cn(
				'block',
				animations.accentsEnabled &&
					'transition-transform duration-400 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none'
			)}
			style="transform: translateY(calc({phase} * -1lh))"
		>
			{#each PHASES as message (message)}
				<span
					class="shimmer shimmer-color-foreground shimmer-spread-[24px] shimmer-duration-1000 block h-[1lh] truncate text-muted-foreground"
				>
					{message}
				</span>
			{/each}
		</span>
	</span>
</span>
