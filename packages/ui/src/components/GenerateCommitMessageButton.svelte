<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import Sparkle from '@lucide/svelte/icons/sparkle';
	import { Button } from './ui/button';
	import * as Popover from './ui/popover';
	import HarnessLogo from './HarnessLogo.svelte';
	import StreamingText from './StreamingText.svelte';
	import { actions, app, effectiveCommitMessageHarness } from '@super-review/ui/store.svelte';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import { cn } from '@super-review/ui/utils';
	import { harnessLabel } from '@super-review/core/types';

	let {
		disabled = false,
		open = $bindable(false),
		onGenerated,
		onFocusAfterGenerate
	}: {
		disabled?: boolean;
		// Bindable so a harness (Storybook) can drive the popover; the component
		// opens and closes it on its own otherwise.
		open?: boolean;
		onGenerated: (result: { subject: string; body: string }) => void;
		// Called once the closing popover has released focus, so the caller can put
		// it somewhere useful (the commit button) instead of the trigger.
		onFocusAfterGenerate?: () => void;
	} = $props();

	// Long enough that brushing past the sparkle does nothing; short enough that
	// staying on it after the click shows the run without feeling stuck.
	const HOVER_OPEN_DELAY_MS = 400;
	// Grace period so the pointer can cross the gap to the panel (and to Cancel).
	const HOVER_CLOSE_DELAY_MS = 200;

	let streamEl = $state<HTMLDivElement | null>(null);
	let waitingHeight = $state(0);
	let streamingHeight = $state(0);
	let panelHeight = $state(0);
	let hoverOpenTimer: ReturnType<typeof setTimeout> | undefined;
	let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined;
	let pointerOverTrigger = false;

	const animations = useAnimations();
	const generating = $derived(app.commitMessageGenerating);
	const streamText = $derived(app.commitMessageStream.trim());
	// Null until detection finishes, and whenever no supported CLI is installed —
	// there is nothing to generate with, so the whole control stays hidden.
	const generateHarness = $derived(effectiveCommitMessageHarness());
	const canGenerate = $derived(!disabled && !generating);

	// True from the moment a run is asked for, a beat before the main process
	// reports `generating`. Drives the shimmer and the hover-to-peek window, so
	// both start on the click rather than after the round trip.
	let runPending = $state(false);
	const running = $derived(generating || runPending);

	// Only while idle. Once a run starts, the same hover is what opens the panel,
	// and a native tooltip would sit on top of it saying the same thing — the
	// shimmering sparkle already says it is working.
	const idleTitle = $derived(
		running || !generateHarness
			? undefined
			: `Generate commit message with ${harnessLabel(generateHarness)}`
	);

	// The text on screen. The store clears the stream the moment a run resolves,
	// so the last frame is held while the popover fades out — dropping back to
	// "Thinking…" on the way out would read as a restart. Resyncs on open.
	let shownStream = $state('');

	// Set when a run lands. The popover traps focus while open and restores it to
	// the trigger on close, so the hand-off waits for the layer to let go.
	let focusHandedOff = false;

	$effect(() => {
		if (streamText) shownStream = streamText;
	});

	$effect(() => {
		if (open) shownStream = untrack(() => streamText);
	});

	// The panel takes the height of whichever face is showing (+8 for its own
	// padding). Both faces stay mounted, so both heights are always measured.
	$effect(() => {
		const next = shownStream ? streamingHeight : waitingHeight;
		if (next > 0) panelHeight = next + 8;
	});

	// Crossfade between waiting and streaming. Both faces are always mounted (the
	// inactive one is inert), so this is a CSS transition rather than a mount: it
	// interrupts cleanly and survives the main thread being busy with the stream.
	const panelFace = cn(
		'absolute inset-x-1 top-1 flex flex-col gap-1.5 opacity-0 data-[active=true]:opacity-100',
		animations.accentsEnabled &&
			// Entering settles up into place over 180ms; leaving just fades, faster —
			// an exit is simpler than an entrance, and the height carries the motion.
			'translate-y-[3px] blur-[2px] transition-[opacity,filter,transform] duration-[120ms] ease-out data-[active=true]:translate-y-0 data-[active=true]:blur-none data-[active=true]:duration-[180ms] data-[active=true]:ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:translate-y-0 motion-reduce:blur-none'
	);

	// Follow the stream so the newest tokens stay in view.
	$effect(() => {
		const el = streamEl;
		const text = streamText;
		if (!el || !text) return;
		el.scrollTop = el.scrollHeight;
	});

	function clearHoverTimers(): void {
		clearTimeout(hoverOpenTimer);
		clearTimeout(hoverCloseTimer);
		hoverOpenTimer = undefined;
		hoverCloseTimer = undefined;
	}

	// The panel is a peek at a run in progress, so it only ever opens on hover
	// while one is happening — never on the idle button.
	function scheduleHoverOpen(): void {
		clearTimeout(hoverCloseTimer);
		if (open || !running) return;
		clearTimeout(hoverOpenTimer);
		hoverOpenTimer = setTimeout(() => {
			if (running) open = true;
		}, HOVER_OPEN_DELAY_MS);
	}

	function scheduleHoverClose(): void {
		clearTimeout(hoverOpenTimer);
		clearTimeout(hoverCloseTimer);
		hoverCloseTimer = setTimeout(() => {
			open = false;
		}, HOVER_CLOSE_DELAY_MS);
	}

	function onTriggerEnter(): void {
		pointerOverTrigger = true;
		scheduleHoverOpen();
	}

	function onTriggerLeave(): void {
		pointerOverTrigger = false;
		scheduleHoverClose();
	}

	async function runGenerate(): Promise<void> {
		if (!canGenerate) return;
		// Set before the first await so the shimmer and the hover-to-peek window
		// start on the click, not on the round trip.
		runPending = true;
		shownStream = '';
		try {
			// Everything else — harness, model, prompt — comes from settings.
			const result = await actions.generateCommitMessage();
			// Nothing came back. A cancel has already closed the popover and must not
			// be reopened; a failure just leaves the toast.
			if (!result) return;
			focusHandedOff = true;
			onGenerated(result);
			open = false;
		} finally {
			runPending = false;
		}
	}

	async function cancelGenerate(): Promise<void> {
		// Cancelling ends the run, so the panel goes with it.
		clearHoverTimers();
		open = false;
		await actions.cancelCommitMessageGeneration();
	}

	function onTriggerClick(): void {
		if (disabled) return;
		// While a run is in flight the button is the way to look at it, rather than
		// waiting out the hover delay.
		if (running) {
			clearHoverTimers();
			open = !open;
			return;
		}
		void runGenerate();
		// The pointer is still on the button after the click, so start the peek
		// window here — mouseenter already fired, back when nothing was running.
		if (pointerOverTrigger) scheduleHoverOpen();
	}

	// The layer is done with focus. After a generated message that means handing it
	// to the caller (the commit button) rather than the trigger.
	function onCloseFocus(e: Event): void {
		if (!focusHandedOff) return;
		focusHandedOff = false;
		e.preventDefault();
		onFocusAfterGenerate?.();
	}

	onDestroy(clearHoverTimers);
</script>

<!-- No installed agent CLI means nothing to generate with, so no button at all.
     `generateHarness` is also null while detection is still running, which keeps
     the sparkle from appearing and then vanishing. -->
{#if generateHarness}
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					class={cn(
						'absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
						typeof props.class === 'string' ? props.class : undefined
					)}
					{disabled}
					title={idleTitle}
					aria-label={running
						? `Generating commit message with ${harnessLabel(generateHarness)}`
						: `Generate commit message with ${harnessLabel(generateHarness)}`}
					onmouseenter={onTriggerEnter}
					onmouseleave={onTriggerLeave}
					onclick={onTriggerClick}
				>
					{#if running}
						<!-- The shimmer default spread (3ch + 40px) is tuned for a line of text and is
						     far wider than this glyph, so the highlight never sweeps across it, it just
						     fades the whole thing. A small explicit spread makes the sweep read at icon
						     size. shimmer-color pins the highlight to the brand colour instead of
						     deriving it from currentColor, which in light mode resolves to a 20%-alpha
						     tint of the base and fades the glyph out rather than lighting it up. -->
						<span
							class="shimmer shimmer-spread-[7px] shimmer-duration-1000 shimmer-color-primary text-[15px] leading-none"
							aria-hidden="true">✦</span
						>
					{:else}
						<Sparkle class="size-3.5" />
					{/if}
				</button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content
			align="center"
			side="bottom"
			sideOffset={6}
			avoidCollisions={false}
			class="w-64 gap-1.5 p-1.5"
			onOpenAutoFocus={(e) => e.preventDefault()}
			onCloseAutoFocus={onCloseFocus}
			onmouseenter={() => clearTimeout(hoverCloseTimer)}
			onmouseleave={scheduleHoverClose}
		>
			<!-- Waiting and streaming are different heights, so the panel resizes
			     between them instead of the popover snapping. -m-1/p-1 keeps the clip
			     off the inner focus rings. -->
			<div
				class={cn(
					'relative -m-1 overflow-hidden p-1',
					animations.accentsEnabled &&
						'transition-[height] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none'
				)}
				style={panelHeight ? `height: ${panelHeight}px` : undefined}
			>
				<!-- CLIs can sit silent for a while before the first token: name the
				     harness that is working so the wait doesn't read as a hang. -->
				<div
					class={panelFace}
					data-active={!shownStream}
					inert={!!shownStream}
					bind:clientHeight={waitingHeight}
				>
					<div class="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
						<HarnessLogo harness={generateHarness} size={14} class="shrink-0" />
						<!-- shimmer-color-foreground: the default highlight is a 20%-alpha tint
						     of currentColor, which fades the label in light mode instead of
						     lighting it up. -->
						<span
							class="shimmer shimmer-color-foreground shimmer-spread-[24px] shimmer-duration-1500"
						>
							Thinking…
						</span>
					</div>
				</div>

				<!-- Fixed height, not max-height: the panel resizes once when the first
				     token lands and then holds still, so Cancel stays put while the rest
				     of the response streams in. The bar is hidden (no-scrollbar) because
				     this scrolls itself to follow the stream — nobody reads back through
				     it while it is still being written. -->
				<div
					class={panelFace}
					data-active={!!shownStream}
					inert={!shownStream}
					bind:clientHeight={streamingHeight}
				>
					<div
						bind:this={streamEl}
						class="no-scrollbar h-24 overflow-y-auto px-2 py-1.5 text-[11px] text-muted-foreground"
					>
						<StreamingText text={shownStream} />
					</div>
				</div>
			</div>

			<Button type="button" variant="outline" size="sm" class="w-full" onclick={cancelGenerate}>
				Cancel
			</Button>
		</Popover.Content>
	</Popover.Root>
{/if}
