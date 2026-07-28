<script lang="ts">
	// One control: click to write a commit message, click again to stop. The
	// message itself streams into the commit box, so there is no panel — and
	// nothing to configure here either, that lives in Settings → Agents.
	import { actions, app, effectiveCommitMessageHarness } from '@super-review/ui/store.svelte';
	import { cn } from '@super-review/ui/utils';
	import { harnessLabel } from '@super-review/core/types';

	let {
		disabled = false,
		onGenerated,
		onFocusAfterGenerate
	}: {
		disabled?: boolean;
		onGenerated: (result: { subject: string; body: string }) => void;
		// Called after a message lands, so the caller can move focus on (the commit
		// button) instead of leaving it on this button.
		onFocusAfterGenerate?: () => void;
	} = $props();

	const generating = $derived(app.commitMessageGenerating);
	// Null until detection finishes, and whenever no supported CLI is installed —
	// there is nothing to generate with, so the whole control stays hidden.
	const generateHarness = $derived(effectiveCommitMessageHarness());

	// True from the moment a run is asked for, a beat before the main process
	// reports `generating`, so the shimmer starts on the click rather than after
	// the round trip.
	let runPending = $state(false);
	const running = $derived(generating || runPending);

	const label = $derived(
		!generateHarness
			? ''
			: running
				? 'Stop generating the commit message'
				: `Generate commit message with ${harnessLabel(generateHarness)}`
	);

	async function runGenerate(): Promise<void> {
		if (disabled || running) return;
		runPending = true;
		try {
			// Harness, model and prompt all come from settings.
			const result = await actions.generateCommitMessage();
			if (!result) return;
			onGenerated(result);
			onFocusAfterGenerate?.();
		} finally {
			runPending = false;
		}
	}

	function onClick(): void {
		if (disabled) return;
		// The same button stops the run: while one is in flight it is the only
		// affordance on screen, and the box is showing what it would produce.
		if (running) {
			void actions.cancelCommitMessageGeneration();
			return;
		}
		void runGenerate();
	}
</script>

<!-- No installed agent CLI means nothing to generate with, so no button at all.
     `generateHarness` is also null while detection is still running, which keeps
     the sparkle from appearing and then vanishing. -->
{#if generateHarness}
	<button
		type="button"
		class={cn(
			'absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
		)}
		{disabled}
		title={label}
		aria-label={label}
		onclick={onClick}
	>
		<!-- Same glyph idle and running, so the button does not swap shapes when a run
		     starts, only picks up the shimmer.
		     The shimmer default spread (3ch + 40px) is tuned for a line of text and is
		     far wider than this glyph, so the highlight never sweeps across it, it just
		     fades the whole thing. A small explicit spread makes the sweep read at icon
		     size. shimmer-color pins the highlight to the brand colour instead of
		     deriving it from currentColor, which in light mode resolves to a 20%-alpha
		     tint of the base and fades the glyph out rather than lighting it up. -->
		<span
			class={cn(
				'text-[15px] leading-none',
				running && 'shimmer shimmer-spread-[7px] shimmer-duration-1000 shimmer-color-primary'
			)}
			aria-hidden="true">✦</span
		>
	</button>
{/if}
