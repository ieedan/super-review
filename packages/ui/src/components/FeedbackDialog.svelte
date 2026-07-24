<script lang="ts">
	import Bug from '@lucide/svelte/icons/bug';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Send from '@lucide/svelte/icons/send';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from './ui/button';
	import { Input } from './ui/input';
	import { Textarea } from './ui/textarea';
	import * as Dialog from './ui/dialog';
	import { actions, app } from '@super-review/ui/store.svelte';
	import { cn } from '@super-review/ui/utils';
	import type { ErrorContext, FeedbackCategory, FeedbackResult } from '@super-review/core/types';

	const open = $derived(app.feedbackDialogOpen);

	// The three categories the user can pick from. The value is what we send; the
	// icon/label drive the segmented selector.
	const CATEGORIES: { value: FeedbackCategory; label: string; icon: typeof Bug }[] = [
		{ value: 'bug', label: 'Bug', icon: Bug },
		{ value: 'idea', label: 'Idea', icon: Lightbulb },
		{ value: 'other', label: 'Other', icon: MessageCircle }
	];

	let category = $state<FeedbackCategory>('bug');
	let title = $state('');
	let body = $state('');
	// Optional reply-to. Feedback no longer becomes a public GitHub issue the
	// reporter can watch, so this is their only way to hear back.
	let email = $state('');
	// Carried straight through from the prefill. The user never edits it, so it
	// is state rather than an input.
	let context = $state<ErrorContext | undefined>(undefined);
	let submitting = $state(false);
	let errorMsg = $state<string | null>(null);
	// Set once the submission is stored — flips the dialog to its "thanks" view.
	let result = $state<FeedbackResult | null>(null);

	// Reset every field whenever the dialog opens so a fresh report never inherits
	// the previous one's text or success state. When opened from a one-click error
	// report, `feedbackPrefill` seeds the category/title/body instead of blanks.
	$effect(() => {
		if (open) {
			const prefill = app.feedbackPrefill;
			category = prefill?.category ?? 'bug';
			title = prefill?.title ?? '';
			body = prefill?.body ?? '';
			email = '';
			context = prefill?.context;
			errorMsg = null;
			result = null;
			submitting = false;
		}
	});

	const canSubmit = $derived(title.trim().length > 0 && body.trim().length > 0 && !submitting);

	async function submit(): Promise<void> {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = null;
		try {
			result = await actions.submitFeedback({
				category,
				title: title.trim(),
				body: body.trim(),
				email: email.trim() || undefined,
				context
			});
		} catch (err) {
			// Inline so the user keeps their typed text and can retry.
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			submitting = false;
		}
	}

	function close(): void {
		actions.closeFeedbackDialog();
	}

	// Cmd/Ctrl+Enter submits from either field, matching the app's commit/comment
	// composers.
	function onKeydown(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submit();
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && close()}>
	<Dialog.Content class="w-[460px] max-w-[92vw]">
		{#if result}
			<!-- Success view: confirm and offer a link to the created issue. -->
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2 text-sm font-semibold">
					<CircleCheck class="size-4 shrink-0 text-success" />
					Thanks for the feedback!
				</Dialog.Title>
				<Dialog.Description class="text-xs">
					Your report reached the team. We read every one.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button size="sm" onclick={close}>Done</Button>
			</Dialog.Footer>
		{:else}
			<Dialog.Header>
				<Dialog.Title class="text-sm font-semibold">Send feedback</Dialog.Title>
				<Dialog.Description class="text-xs">
					Report a bug or share an idea. This goes straight to the Super Review team.
				</Dialog.Description>
			</Dialog.Header>

			<div class="flex flex-col gap-4">
				<!-- Category selector -->
				<div class="flex flex-col gap-1.5">
					<span class="text-xs font-medium text-muted-foreground">Category</span>
					<div class="grid grid-cols-3 gap-1.5">
						{#each CATEGORIES as c (c.value)}
							{@const Icon = c.icon}
							<button
								type="button"
								onclick={() => (category = c.value)}
								aria-pressed={category === c.value}
								class={cn(
									'flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors',
									category === c.value
										? 'border-primary bg-primary/10 text-foreground'
										: 'border-border text-muted-foreground hover:bg-accent'
								)}
							>
								<Icon class="size-3.5" />
								{c.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Title -->
				<div class="flex flex-col gap-1.5">
					<label for="feedback-title" class="text-xs font-medium text-muted-foreground">
						Title
					</label>
					<Input
						id="feedback-title"
						bind:value={title}
						maxlength={120}
						placeholder="A short summary"
						disabled={submitting}
						onkeydown={onKeydown}
					/>
				</div>

				<!-- Body -->
				<div class="flex flex-col gap-1.5">
					<label for="feedback-body" class="text-xs font-medium text-muted-foreground">
						Details
					</label>
					<Textarea
						id="feedback-body"
						bind:value={body}
						rows={5}
						placeholder="What happened, what you expected, steps to reproduce…"
						disabled={submitting}
						onkeydown={onKeydown}
						class="resize-none"
					/>
				</div>

				<!-- Reply-to. Optional, and labelled as such, so it never reads as a
					 gate on sending. -->
				<div class="flex flex-col gap-1.5">
					<label for="feedback-email" class="text-xs font-medium text-muted-foreground">
						Email <span class="font-normal">(optional, if you want a reply)</span>
					</label>
					<Input
						id="feedback-email"
						type="email"
						bind:value={email}
						maxlength={320}
						placeholder="you@example.com"
						disabled={submitting}
						onkeydown={onKeydown}
					/>
				</div>

				{#if errorMsg}
					<div
						class="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive"
					>
						<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
						<span class="flex-1">{errorMsg}</span>
					</div>
				{/if}
			</div>

			<Dialog.Footer>
				<Button variant="secondary" size="sm" onclick={close} disabled={submitting}>Cancel</Button>
				<Button size="sm" onclick={submit} disabled={!canSubmit}>
					{#if submitting}
						<LoaderCircle class="size-3.5 animate-spin" />
						Sending…
					{:else}
						<Send class="size-3.5" />
						Send feedback
					{/if}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
