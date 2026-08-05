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

	import Check from '@lucide/svelte/icons/check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Regex from '@lucide/svelte/icons/regex';
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
	// value so the highlight can never disagree with the status line, even for the
	// frame between a keystroke and its evaluation.
	const segments = $derived(
		evaluation.status === 'match' ? segmentsFor(settled, evaluation.ranges) : null
	);

	const statusText = $derived.by(() => {
		switch (evaluation.status) {
			case 'invalid':
				return evaluation.error;
			case 'idle':
				return 'Waiting for a test string';
			case 'no-match':
				return 'No match';
			case 'match':
				return describeMatch(evaluation.ranges);
		}
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
		<span class="flex items-center gap-1.5">
			<Regex class="size-3.5" />
			Test regex
		</span>
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
		class="w-88 gap-0 p-0"
	>
		{#if target}
			<!-- Header: the literal as written, so the popup is self-identifying once
			     it covers the code it came from. Truncated rather than wrapped; the
			     title attribute gives the full text back on hover. -->
			<div class="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
				<Regex class="size-3.5 shrink-0 text-muted-foreground" />
				<code class="regex-source truncate text-xs text-foreground/90" title={target.source}>
					{target.source}
				</code>
			</div>

			<div class="p-3">
				<!-- Input + highlight backdrop. The input's own text is transparent and
				     the backdrop paints the same string underneath with the matched runs
				     highlighted, so the caret and selection stay native. -->
				<div class="regex-field relative">
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

				<!-- Status. The row is always present so a match/no-match flip doesn't
				     resize the card under the pointer, and it's a polite live region so
				     the result is announced as the user types rather than only being
				     visible. -->
				<div role="status" aria-live="polite" class="mt-2 flex min-h-4 items-start gap-1.5 text-xs">
					{#key statusText}
						<span
							class="flex items-start gap-1.5 {animations.accentsEnabled
								? 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-0.5 motion-safe:duration-150'
								: ''} {evaluation.status === 'match'
								? 'text-success'
								: evaluation.status === 'invalid'
									? 'text-destructive'
									: 'text-muted-foreground'}"
						>
							{#if evaluation.status === 'match'}
								<Check class="mt-px size-3.5 shrink-0" />
							{:else if evaluation.status === 'invalid'}
								<TriangleAlert class="mt-px size-3.5 shrink-0" />
							{/if}
							<span class="min-w-0">{statusText}</span>
						</span>
					{/key}
				</div>
			</div>
		{/if}
	</PopoverContent>
</Popover>

<style>
	/* The literal in the header, in the same font the diff renders it in. */
	.regex-source {
		font-family: var(--code-font, ui-monospace, monospace);
		font-feature-settings: var(--code-font-features, normal);
	}

	/* The input and its backdrop must be pixel-identical boxes, so every metric
	   that affects text layout is declared once here and inherited by both. */
	.regex-field {
		--regex-pad-x: 0.5rem;
		--regex-pad-y: 0.3125rem;
		/* The user's chosen code font, so a test string lines up visually with the
		   literal it came from. */
		font-family: var(--code-font, ui-monospace, monospace);
		font-feature-settings: var(--code-font-features, normal);
		font-size: 0.75rem;
		line-height: 1.25rem;
	}

	.regex-backdrop,
	.regex-input {
		box-sizing: border-box;
		width: 100%;
		padding: var(--regex-pad-y) var(--regex-pad-x);
		border: 1px solid transparent;
		border-radius: 0.5rem;
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
		border-color: var(--color-input);
		/* Transparent glyphs let the backdrop's copy (with its highlights) show
		   through, while the caret keeps a real colour of its own. */
		color: transparent;
		caret-color: var(--color-foreground);
		outline: none;
	}

	.regex-input::placeholder {
		color: var(--color-muted-foreground);
	}

	.regex-input:focus {
		border-color: var(--color-ring);
		box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-ring) 50%, transparent);
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
		font-weight: 600;
		border-radius: 0.1875rem;
		/* Keep the glyph advance identical to the input's, or the highlight would
		   drift from the caret: no padding, no margin. */
		padding: 0;
	}
</style>
