<script lang="ts">
	// The inline regex tester. One instance is mounted in the diff view; it reads
	// the shared `regexTester` controller (driven by Pierre's token events) and
	// renders two surfaces for whatever literal the user is on:
	//
	//   - a small "Test regex" hint while the pointer rests on a literal;
	//   - the tester popup itself once the literal is clicked, where typing a test
	//     string evaluates it live against the browser's own RegExp engine.
	//
	// Both are built on the app's Popover primitive (bits-ui) anchored to the
	// literal via `customAnchor`, so they get Floating UI positioning, collision
	// flipping and portaling for free rather than hand-rolled placement.
	//
	// The popup is deliberately spare: a bare input, then a rule and the verdict
	// once there's something to say. No header repeating the literal (it's in the
	// code directly above the popup), no chrome around the input, no character
	// arithmetic. The answer a reviewer wants is "does this match, and what did it
	// match", so that's all there is.

	import Check from '@lucide/svelte/icons/check';
	import { Popover, PopoverContent } from './ui/popover';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import { regexTester, closeRegexTester } from '@super-review/ui/regex-tester.svelte';
	import { evaluateRegex, segmentsFor, describeMatch } from '@super-review/ui/regex-match';

	const animations = useAnimations();

	// The test string, as typed. Owned by this component rather than the
	// controller: a tester opened on a different literal starts empty (saved test
	// cases are a non-goal), and nothing outside the popup reads it.
	let input = $state('');
	// The same value, settled. Evaluation runs off this so a fast typist isn't
	// re-running the engine on every intermediate keystroke; one frame's worth of
	// delay is below the threshold where the result feels detached from typing.
	let settled = $state('');
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	const SETTLE_MS = 24;

	let inputEl = $state<HTMLInputElement | null>(null);
	let backdropEl = $state<HTMLElement | null>(null);

	const target = $derived(regexTester.openTarget);
	const open = $derived(target != null);

	// Each literal gets a fresh test string; keying on the literal's identity also
	// covers retargeting straight from one open tester to another.
	$effect(() => {
		void target?.key;
		input = '';
		settled = '';
		if (settleTimer != null) {
			clearTimeout(settleTimer);
			settleTimer = null;
		}
	});

	// Auto-focus the input on open. bits-ui focuses the content element itself;
	// moving focus into the input means the user can type immediately, which is
	// the whole point of the popup.
	$effect(() => {
		if (open && inputEl) inputEl.focus();
	});

	function onInput(): void {
		if (settleTimer != null) clearTimeout(settleTimer);
		settleTimer = setTimeout(() => {
			settleTimer = null;
			settled = input;
		}, SETTLE_MS);
	}

	// Keep the highlight backdrop aligned with the input while the caret pushes
	// the text out of view. Both are the same monospace box, so a matching
	// scrollLeft is all the sync they need.
	function onScroll(): void {
		if (backdropEl && inputEl) backdropEl.scrollLeft = inputEl.scrollLeft;
	}

	const evaluation = $derived(
		target ? evaluateRegex(target.pattern, target.flags, settled) : { status: 'idle' as const }
	);

	// The matched/unmatched runs painted behind the input. Built from the settled
	// value so the highlight can never disagree with the verdict, even for the
	// frame between a keystroke and its evaluation.
	const segments = $derived(
		evaluation.status === 'match' ? segmentsFor(settled, evaluation.ranges) : null
	);

	const verdict = $derived.by(() => {
		switch (evaluation.status) {
			case 'invalid':
				return evaluation.error;
			case 'idle':
				return null;
			case 'no-match':
				return 'No match';
			case 'match':
				return describeMatch(evaluation.ranges);
		}
	});

	// What a single match actually captured, spelled out under the verdict. It's
	// the thing you check a partial match against, and it's more useful than the
	// character offsets it replaced. Only for one non-empty match: with several,
	// the highlighting in the input already shows them all, and listing them would
	// rebuild the clutter this layout exists to avoid.
	const matchedText = $derived.by(() => {
		if (evaluation.status !== 'match' || evaluation.ranges.length !== 1) return null;
		const [range] = evaluation.ranges;
		return range.end > range.start ? settled.slice(range.start, range.end) : null;
	});
</script>

<!-- Hover hint. Non-interactive by design: it's a label for the affordance, so
     it must never eat the click that opens the tester. -->
<Popover open={regexTester.hintArmed && regexTester.hintTarget != null}>
	<PopoverContent
		customAnchor={regexTester.hintAnchor}
		side="top"
		align="start"
		sideOffset={4}
		trapFocus={false}
		onOpenAutoFocus={(e) => e.preventDefault()}
		onCloseAutoFocus={(e) => e.preventDefault()}
		class="pointer-events-none w-fit gap-0 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-none ring-0"
	>
		Test regex
	</PopoverContent>
</Popover>

<!-- The tester. -->
<Popover
	{open}
	onOpenChange={(next) => {
		// Covers Escape and outside clicks; clicking the literal again is handled
		// by the controller's toggle.
		if (!next) closeRegexTester();
	}}
>
	<PopoverContent
		customAnchor={regexTester.openAnchor}
		side="bottom"
		align="start"
		sideOffset={6}
		class="w-80 gap-0 overflow-hidden p-0"
	>
		{#if target}
			<!-- Input + highlight backdrop. The input's own text is transparent and
			     the backdrop paints the same string underneath with the matched runs
			     highlighted, so the caret and selection stay native. No border or
			     focus ring: the popup only exists while it's focused, so ringing it
			     would be decoration announcing something already obvious. -->
			<div class="regex-field flex items-center gap-2 px-3 py-2.5">
				<div class="relative min-w-0 flex-1">
					<div bind:this={backdropEl} class="regex-backdrop" aria-hidden="true">
						{#if segments}
							{#each segments as segment, i (i)}
								{#if segment.matched}<mark class="regex-hit">{segment.text}</mark
									>{:else}{segment.text}{/if}
							{/each}
						{:else}
							{settled}
						{/if}
					</div>
					<input
						bind:this={inputEl}
						bind:value={input}
						oninput={onInput}
						onscroll={onScroll}
						class="regex-input"
						type="text"
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"
						autocorrect="off"
						aria-label="Test string"
						placeholder="Enter text to match…"
					/>
				</div>
				{#if evaluation.status === 'match'}
					<Check class="size-4 shrink-0 text-muted-foreground" />
				{/if}
			</div>

			<!-- The verdict, and what matched. Absent entirely until there's
			     something to report, so an untouched tester is just an input. A
			     compatibility note counts as something to report on its own: it's a
			     caveat about the answer, so it can't wait for the user to type. -->
			{#if verdict || target.note}
				<div
					role="status"
					aria-live="polite"
					class="border-t border-foreground/10 px-3 py-2.5 {animations.accentsEnabled
						? 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150'
						: ''}"
				>
					{#if verdict}
						<p
							class="text-xs {evaluation.status === 'invalid'
								? 'text-destructive'
								: 'text-muted-foreground'}"
						>
							{verdict}
						</p>
					{/if}
					{#if matchedText}
						<p class="regex-matched mt-1 truncate text-xs text-foreground">{matchedText}</p>
					{/if}
					{#if target.note}
						<!-- The pattern was written for another engine and this one differs
						     on it. Rare enough to earn the space, and always more useful
						     than the verdict above it, which it may well contradict. -->
						<p class="mt-1.5 text-xs text-warning" class:mt-0={!verdict && !matchedText}>
							{target.note}
						</p>
					{/if}
				</div>
			{/if}
		{/if}
	</PopoverContent>
</Popover>

<style>
	/* The input and its backdrop must be pixel-identical boxes, so every metric
	   that affects text layout is declared once here and inherited by both. */
	.regex-field {
		/* The user's chosen code font, so a test string lines up visually with the
		   literal it came from. */
		font-family: var(--code-font, ui-monospace, monospace);
		font-feature-settings: var(--code-font-features, normal);
		font-size: 0.8125rem;
		line-height: 1.375rem;
	}

	.regex-backdrop,
	.regex-input {
		box-sizing: border-box;
		width: 100%;
		padding: 0;
		border: 0;
		font: inherit;
		letter-spacing: inherit;
		/* Single-line: preserve spacing exactly, never wrap, so a character in the
		   backdrop sits at the same x as the same character in the input. */
		white-space: pre;
		overflow-x: auto;
	}

	.regex-backdrop {
		position: absolute;
		inset: 0;
		color: var(--color-foreground);
		/* The input above owns all pointer interaction (caret placement, drag
		   selection); the backdrop is pure paint. */
		pointer-events: none;
		/* Scrolled programmatically in step with the input, never by the user. */
		scrollbar-width: none;
	}

	.regex-backdrop::-webkit-scrollbar {
		display: none;
	}

	.regex-input {
		position: relative;
		background: transparent;
		/* Transparent glyphs let the backdrop's copy (with its highlights) show
		   through, while the caret keeps a real colour of its own. */
		color: transparent;
		caret-color: var(--color-foreground);
		outline: none;
	}

	.regex-input::placeholder {
		color: var(--color-muted-foreground);
	}

	/* Selection has to be translucent: an opaque highlight would paint over the
	   backdrop and blank out the selected text, since the input's own glyphs are
	   transparent. */
	.regex-input::selection {
		background: color-mix(in oklch, var(--color-ring) 35%, transparent);
	}

	.regex-hit {
		background: color-mix(in oklch, var(--color-success) 38%, transparent);
		color: var(--color-foreground);
		border-radius: 0.1875rem;
		/* Nothing here may change the glyph advance, or the highlight would drift
		   from the caret: no padding, no margin, and no bolder weight (a bold face
		   is not guaranteed to keep the regular face's metrics). */
		padding: 0;
	}

	/* The matched text under the verdict, in the same font as the input it came
	   from. */
	.regex-matched {
		font-family: var(--code-font, ui-monospace, monospace);
		font-feature-settings: var(--code-font-features, normal);
	}
</style>
