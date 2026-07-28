<script lang="ts">
	// The commit box as far as this flow is concerned: the Summary field with the
	// sparkle in its corner, the Description the body lands in, and the Commit
	// button focus moves to. Mirrors CommitBox's markup for these controls —
	// including the streaming overlays — without dragging in accounts, drafts, or
	// push state.
	import { Button } from '@super-review/ui/components/ui/button';
	import { Input } from '@super-review/ui/components/ui/input';
	import { Textarea } from '@super-review/ui/components/ui/textarea';
	import CommitMessageWaiting from '@super-review/ui/components/CommitMessageWaiting.svelte';
	import GenerateCommitMessageButton from '@super-review/ui/components/GenerateCommitMessageButton.svelte';
	import StreamingText from '@super-review/ui/components/StreamingText.svelte';
	import { untrack } from 'svelte';
	import { app } from '@super-review/ui/store.svelte';
	import { splitStreamingMessage } from '@super-review/ui/commit-message-stream';
	import { cn } from '@super-review/ui/utils';

	let { subject = $bindable(''), body = $bindable('') }: { subject?: string; body?: string } =
		$props();

	let commitButtonRef = $state<HTMLButtonElement | null>(null);

	// Same pairing CommitBox uses: the field and its overlay share one set of
	// metrics so the text does not change size when the real value lands.
	const SUMMARY_METRICS = 'px-2.5 py-1 pr-8 text-xs md:text-sm';
	const BODY_METRICS = 'px-2 py-1.5 text-xs';
	// Also from CommitBox: hiding the real value with `text-transparent` would put a
	// 150ms color transition on the handoff, so the message blinks out and back
	// when the overlay comes down. See the comment there.
	const HIDE_FIELD_TEXT = '[-webkit-text-fill-color:transparent]';

	const generating = $derived(app.commitMessageGenerating);

	// Same latch as CommitBox: the paint outlives `generating` and ends where the
	// values are written, so there is never a frame with neither on screen.
	let painting = $state(false);
	let painted = $state<{ subject: string; body: string }>({ subject: '', body: '' });
	let paintRun = 0;

	$effect(() => {
		const live = splitStreamingMessage(app.commitMessageAnswer);
		if (generating) {
			untrack(() => {
				if (!painting) {
					painting = true;
					painted = { subject: '', body: '' };
					paintRun++;
				}
				if (live.subject || live.body) painted = live;
			});
			return;
		}
		if (!untrack(() => painting)) return;
		const run = ++paintRun;
		queueMicrotask(() => {
			if (run === paintRun) endPaint();
		});
	});

	function endPaint(): void {
		painting = false;
		painted = { subject: '', body: '' };
	}

	const awaitingFirstToken = $derived(painting && !painted.subject && !painted.body);
</script>

<div class="flex w-[420px] flex-col gap-2 rounded-lg border border-border bg-card p-3">
	<div class="relative min-w-0 flex-1">
		<Input
			type="text"
			bind:value={subject}
			placeholder={painting ? '' : 'Summary (required)'}
			readonly={painting}
			class={cn('h-7 min-w-0', SUMMARY_METRICS, painting && HIDE_FIELD_TEXT)}
		/>
		{#if painting}
			<div
				class={cn(
					'pointer-events-none absolute inset-0 flex items-center overflow-hidden border border-transparent',
					SUMMARY_METRICS
				)}
			>
				{#if awaitingFirstToken}
					<CommitMessageWaiting />
				{:else}
					<StreamingText text={painted.subject} class="truncate" />
				{/if}
			</div>
		{/if}
		<GenerateCommitMessageButton
			onGenerated={(result) => {
				subject = result.subject;
				body = result.body;
				paintRun++;
				endPaint();
			}}
			onFocusAfterGenerate={() => commitButtonRef?.focus()}
		/>
	</div>

	<div class="relative">
		<Textarea
			bind:value={body}
			placeholder={painting ? '' : 'Description'}
			rows={4}
			readonly={painting}
			class={cn('resize-none', BODY_METRICS, painting && HIDE_FIELD_TEXT)}
		/>
		{#if painting}
			<div
				class={cn(
					'no-scrollbar pointer-events-none absolute inset-0 overflow-y-auto border border-transparent',
					BODY_METRICS
				)}
			>
				<StreamingText text={painted.body} />
			</div>
		{/if}
	</div>

	<Button bind:ref={commitButtonRef} size="sm" class="w-full">
		<span class="truncate text-xs">Commit 2 files to <span class="font-semibold">main</span></span>
	</Button>
</div>
