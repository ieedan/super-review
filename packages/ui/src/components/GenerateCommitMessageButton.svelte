<script lang="ts">
	import { onDestroy } from 'svelte';
	import Settings from '@lucide/svelte/icons/settings';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { Button } from './ui/button';
	import { Textarea } from './ui/textarea';
	import * as Popover from './ui/popover';
	import * as SplitButton from './ui/split-button';
	import CommitMessageModelPicker from './CommitMessageModelPicker.svelte';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app, effectiveCommitMessageHarness } from '@super-review/ui/store.svelte';
	import { cn } from '@super-review/ui/utils';
	import { DEFAULT_COMMIT_MESSAGE_BASE_PROMPT } from '@super-review/core/commit-message-prompt';
	import {
		COMMIT_MESSAGE_HARNESS_PRIORITY,
		harnessLabel,
		type CommitMessageHarness
	} from '@super-review/core/types';

	let {
		disabled = false,
		open = $bindable(false),
		onGenerated
	}: {
		disabled?: boolean;
		// Bindable so a harness (Storybook) can drive the popover; the component
		// opens and closes it on its own otherwise.
		open?: boolean;
		onGenerated: (result: { subject: string; body: string }) => void;
	} = $props();

	const OPEN_DELAY_MS = 200;

	let modelOpen = $state(false);
	let harnessMenuOpen = $state(false);
	// After a nested menu closes, the same outside-click often hits this popover
	// next. Ignore dismiss for a beat so one click only closes the nested menu.
	let nestDismissGuardUntil = 0;
	let promptDraft = $state(DEFAULT_COMMIT_MESSAGE_BASE_PROMPT);
	let promptReady = $state(false);
	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let splitButtonRef = $state<HTMLDivElement | null>(null);
	let splitButtonWidth = $state(0);
	let streamEl = $state<HTMLDivElement | null>(null);

	const generating = $derived(app.commitMessageGenerating);
	const streamText = $derived(app.commitMessageStream.trim());
	const generateHarness = $derived(effectiveCommitMessageHarness());
	const harnessStatus = $derived(app.commitMessageHarnesses);
	const installedHarnesses = $derived(
		COMMIT_MESSAGE_HARNESS_PRIORITY.filter((h) => harnessStatus?.[h])
	);
	// Offer a settings escape hatch when at least one supported harness CLI isn't
	// installed yet (so the menu isn't only listing everything already available).
	const hasMoreHarnesses = $derived(
		harnessStatus != null && COMMIT_MESSAGE_HARNESS_PRIORITY.some((h) => !harnessStatus[h])
	);

	// The model the run uses: the pinned one, else the first of the harness's
	// cached list (prefetched on launch, same list the picker shows).
	const selectedModel = $derived.by(() => {
		const harness = generateHarness;
		if (!harness) return '';
		return (
			app.prefs?.commitMessageModels?.[harness] ?? app.commitMessageModels[harness]?.[0]?.id ?? ''
		);
	});

	const canGenerate = $derived(!disabled && !generating);

	// Monochrome (outline + white) so logos stay readable on the split button.
	const monoBtnClass =
		'border-border bg-white text-neutral-900 shadow-sm hover:bg-neutral-100 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100';

	function ensurePromptReady(): void {
		if (promptReady) return;
		const saved = app.prefs?.commitMessagePrompt;
		promptDraft = saved?.trim() ? saved : DEFAULT_COMMIT_MESSAGE_BASE_PROMPT;
		promptReady = true;
	}

	function clearOpenTimer(): void {
		clearTimeout(openTimer);
		openTimer = undefined;
	}

	function scheduleOpen(e: MouseEvent): void {
		// Shift-click generates immediately; don't open the popover while Shift is held.
		if (disabled || open || e.shiftKey) return;
		clearOpenTimer();
		openTimer = setTimeout(() => {
			ensurePromptReady();
			open = true;
		}, OPEN_DELAY_MS);
	}

	function openNow(): void {
		clearOpenTimer();
		ensurePromptReady();
		open = true;
	}

	// Follow the stream so the newest tokens stay in view. Reading streamText is
	// what re-runs this on every chunk.
	$effect(() => {
		const el = streamEl;
		const text = streamText;
		if (!el || !text) return;
		el.scrollTop = el.scrollHeight;
	});

	// Keep the harness menu as wide as the full split button (action + chevron).
	$effect(() => {
		const el = splitButtonRef;
		if (!el) return;
		splitButtonWidth = el.offsetWidth;
		const ro = new ResizeObserver(() => {
			splitButtonWidth = el.offsetWidth;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	async function persistPrompt(): Promise<void> {
		const next = promptDraft.trim();
		const current = app.prefs?.commitMessagePrompt?.trim() || DEFAULT_COMMIT_MESSAGE_BASE_PROMPT;
		if (next === current) return;
		await actions.setCommitMessagePrompt(next === DEFAULT_COMMIT_MESSAGE_BASE_PROMPT ? '' : next);
	}

	async function selectHarness(value: string): Promise<void> {
		if (!value) return;
		// The picker follows the store cache, which is already populated for every
		// installed harness, so its list swaps without a gap.
		await actions.setCommitMessageHarness(value as CommitMessageHarness);
	}

	function openCommitMessageSettings(): void {
		harnessMenuOpen = false;
		open = false;
		actions.openCommitMessageSettings();
	}

	async function runGenerate(): Promise<void> {
		if (!canGenerate) return;
		ensurePromptReady();
		await persistPrompt();
		const result = await actions.generateCommitMessage({
			preferredHarness: generateHarness,
			basePrompt: promptDraft.trim() || null,
			model: selectedModel || null
		});
		if (!result) return;
		onGenerated(result);
		open = false;
	}

	async function cancelGenerate(): Promise<void> {
		await actions.cancelCommitMessageGeneration();
	}

	function onTriggerClick(e: MouseEvent): void {
		if (disabled) return;
		if (e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			clearOpenTimer();
			open = false;
			void runGenerate();
			return;
		}
		if (open) {
			clearOpenTimer();
			open = false;
			return;
		}
		openNow();
	}

	function onPromptKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void runGenerate();
		}
	}

	function onPopoverOpenChange(next: boolean): void {
		if (!next) {
			modelOpen = false;
			harnessMenuOpen = false;
			void persistPrompt();
		}
	}

	// Nested select/model menus are portaled to <body>, so a click that dismisses
	// them also looks like an outside click on this popover. Keep the popover open
	// while those layers are active (or right after they close from that click).
	function ignoreOutsideForNested(e: Event): void {
		if (harnessMenuOpen || modelOpen || Date.now() < nestDismissGuardUntil) {
			e.preventDefault();
			return;
		}
		const target = e.target;
		if (!(target instanceof Element)) return;
		if (
			target.closest('[data-slot="select-content"]') ||
			target.closest('[data-slot="split-button-content"]')
		) {
			e.preventDefault();
		}
	}

	function onHarnessMenuOpenChange(next: boolean): void {
		harnessMenuOpen = next;
		if (!next) nestDismissGuardUntil = Date.now() + 100;
	}

	function onModelOpenChange(next: boolean): void {
		modelOpen = next;
		if (!next) nestDismissGuardUntil = Date.now() + 100;
	}

	onDestroy(() => clearOpenTimer());
</script>

<Popover.Root bind:open onOpenChange={onPopoverOpenChange}>
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
				title={generateHarness
					? `Generate commit message with ${harnessLabel(generateHarness)}. Shift-click to generate now.`
					: 'Generate commit message. Shift-click to generate now.'}
				aria-label={generateHarness
					? `Generate commit message with ${harnessLabel(generateHarness)}`
					: 'Generate commit message'}
				onmouseenter={scheduleOpen}
				onmouseleave={clearOpenTimer}
				onclick={onTriggerClick}
			>
				{#if generating}
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
					<Sparkles class="size-3.5" />
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
		onInteractOutside={ignoreOutsideForNested}
		onFocusOutside={ignoreOutsideForNested}
	>
		{#if generating}
			<div class="flex flex-col gap-1.5">
				{#if streamText}
					<div
						bind:this={streamEl}
						class="max-h-24 min-h-16 overflow-y-auto px-2 py-1.5 text-[11px] whitespace-pre-wrap text-muted-foreground"
					>
						{streamText}
					</div>
				{:else}
					<!-- CLIs can sit silent for a while before the first token: name the
					     harness that is working so the wait doesn't read as a hang. -->
					<div class="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
						{#if generateHarness}
							<HarnessLogo harness={generateHarness} size={14} class="shrink-0" />
						{/if}
						<!-- shimmer-color-foreground: the default highlight is a 20%-alpha tint
						     of currentColor, which fades the label in light mode instead of
						     lighting it up. -->
						<span
							class="shimmer shimmer-color-foreground shimmer-spread-[24px] shimmer-duration-1500"
						>
							Thinking…
						</span>
					</div>
				{/if}
				<Button type="button" variant="outline" size="sm" class="w-full" onclick={cancelGenerate}>
					Cancel
				</Button>
			</div>
		{:else}
			<div class="flex flex-col gap-1.5">
				<SplitButton.Root
					bind:ref={splitButtonRef}
					class="w-full"
					value={generateHarness ?? undefined}
					disabled={!canGenerate || !generateHarness}
					onClickPromise={() => runGenerate()}
					onActionSelect={(v) => void selectHarness(v)}
				>
					{#each installedHarnesses as harness (harness)}
						<SplitButton.Action
							value={harness}
							size="sm"
							variant="outline"
							class={cn('flex-1 justify-center gap-1.5', monoBtnClass)}
						>
							<span>Generate with</span>
							<HarnessLogo {harness} size={14} class="shrink-0 text-neutral-900" />
						</SplitButton.Action>
					{/each}
					{#if installedHarnesses.length === 0}
						<SplitButton.Action
							value="none"
							size="sm"
							variant="outline"
							disabled
							class={cn('flex-1 justify-center', monoBtnClass)}
						>
							Generate with
						</SplitButton.Action>
					{/if}
					<SplitButton.Select onOpenChange={onHarnessMenuOpenChange}>
						<SplitButton.SelectTrigger
							size="icon-sm"
							variant="outline"
							class={cn('shrink-0', monoBtnClass)}
						/>
						<SplitButton.SelectContent
							align="end"
							class="p-0"
							style={splitButtonWidth ? `width: ${splitButtonWidth}px` : undefined}
						>
							<SplitButton.SelectGroup>
								{#each installedHarnesses as harness (harness)}
									<SplitButton.SelectAction value={harness} label={harnessLabel(harness)}>
										<span class="flex items-center gap-2">
											<HarnessLogo {harness} size={14} />
											{harnessLabel(harness)}
										</span>
									</SplitButton.SelectAction>
								{/each}
							</SplitButton.SelectGroup>
							{#if hasMoreHarnesses}
								<SplitButton.SelectSeparator />
								<button
									type="button"
									class="relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
									onclick={openCommitMessageSettings}
								>
									<Settings class="size-3.5 shrink-0" />
									Configure more in settings
								</button>
							{/if}
						</SplitButton.SelectContent>
					</SplitButton.Select>
				</SplitButton.Root>

				<CommitMessageModelPicker
					harness={generateHarness}
					class="w-full"
					onOpenChange={onModelOpenChange}
				/>

				<Textarea
					bind:value={promptDraft}
					onkeydown={onPromptKeydown}
					onblur={() => void persistPrompt()}
					placeholder="Generate a commit message for these changes…"
					rows={3}
					class="min-h-0 resize-none px-2 py-1 text-[11px] leading-snug"
				/>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
