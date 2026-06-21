<script lang="ts">
	import { untrack } from 'svelte';
	import Bug from '@lucide/svelte/icons/bug';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import X from '@lucide/svelte/icons/x';
	import FileVideo from '@lucide/svelte/icons/file-video';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { Input } from './ui/input';
	import MarkdownComposer from './MarkdownComposer.svelte';
	import { FileDropZone, displaySize, type FileRejectedReason } from './ui/file-drop-zone';
	import { actions, app } from '$lib/store.svelte';
	import { cn } from '$lib/utils';
	import type { FeedbackConfig, FeedbackKind } from '@shared/types';

	const KINDS: { value: FeedbackKind; label: string; icon: typeof Bug }[] = [
		{ value: 'bug', label: 'Bug', icon: Bug },
		{ value: 'feature', label: 'Feature', icon: Lightbulb },
		{ value: 'other', label: 'Other', icon: MessageSquare }
	];

	let config = $state<FeedbackConfig | null>(null);
	let kind = $state<FeedbackKind>('other');
	let title = $state('');
	let body = $state('');
	let diagnostics = $state<string | null>(null);
	// Staged screen recordings, uploaded at submit. Images aren't staged here —
	// they're pasted/attached straight into the description, which uploads them
	// inline via Carta's attachment plugin.
	let stagedVideos = $state<File[]>([]);
	let submitting = $state(false);
	let error = $state<string | null>(null);
	// Set to the created issue on success so we can show a confirmation + link
	// instead of the form.
	let result = $state<{ url: string; number: number } | null>(null);

	const open = $derived(app.feedback.open);

	// Accepted types for the screen-recording picker (videos only).
	const videoAccept = $derived(config?.videoTypes.join(',') ?? '');

	function reset(): void {
		kind = 'other';
		title = '';
		body = '';
		diagnostics = null;
		stagedVideos = [];
		error = null;
		result = null;
		submitting = false;
	}

	// On open: reset the form, apply any prefill (error reports seed kind +
	// diagnostics), and load capabilities/limits. `open` is the only dependency —
	// the body is untracked so the field writes don't make this effect depend on
	// the state it sets (which would risk an update loop).
	$effect(() => {
		if (!open) return;
		untrack(() => {
			reset();
			const prefill = app.feedback.prefill;
			if (prefill) {
				if (prefill.kind) kind = prefill.kind;
				if (prefill.title) title = prefill.title;
				if (prefill.body) body = prefill.body;
				if (prefill.diagnostics) diagnostics = prefill.diagnostics;
			}
			void window.api.feedback.getConfig().then((c) => (config = c));
		});
	});

	function onUpload(files: File[]): void {
		error = null;
		stagedVideos = [...stagedVideos, ...files];
	}

	function onFileRejected({ file, reason }: { file: File; reason: FileRejectedReason }): void {
		const why =
			reason === 'File too large'
				? `it's over the size limit (${displaySize(file.size)})`
				: reason === 'Maximum files'
					? `you can attach at most ${config?.maxFiles} files`
					: `that file type isn't supported`;
		error = `Couldn't attach "${file.name}" — ${why}.`;
	}

	function removeStaged(index: number): void {
		stagedVideos = stagedVideos.filter((_, i) => i !== index);
	}

	async function submit(e?: Event): Promise<void> {
		e?.preventDefault();
		if (submitting) return;
		if (!title.trim()) {
			error = 'Please add a short title.';
			return;
		}
		submitting = true;
		error = null;
		try {
			const attachments = await Promise.all(
				stagedVideos.map(async (file) => ({
					name: file.name,
					mimeType: file.type,
					bytes: new Uint8Array(await file.arrayBuffer())
				}))
			);
			result = await window.api.feedback.submit({
				kind,
				title: title.trim(),
				body,
				attachments,
				diagnostics: diagnostics ?? undefined
			});
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			submitting = false;
		}
	}

	const mediaDisabled = $derived(!config?.uploadConfigured);
	const canSubmit = $derived(!!config?.signedIn && !submitting);

	// ⌘/Ctrl+Enter submits from within the description composer.
	function onComposerKeydown(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submit();
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(o) => (o ? undefined : actions.closeFeedbackDialog())}>
	<Dialog.Content class="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col gap-4 overflow-hidden">
		{#if result}
			<!-- Success state: confirm and link to the filed issue. -->
			<div class="flex flex-col items-center gap-3 py-4 text-center">
				<CircleCheck class="size-10 text-success" />
				<div class="space-y-1">
					<h2 class="text-base font-semibold">Thanks for the feedback!</h2>
					<p class="text-sm text-muted-foreground">
						We filed issue #{result.number}. You can track it on GitHub.
					</p>
				</div>
				<div class="flex gap-2">
					<Button
						variant="secondary"
						size="sm"
						onclick={() => window.api.shell.openExternal(result!.url)}
					>
						<ExternalLink class="size-4" />
						View issue
					</Button>
					<Button size="sm" onclick={() => actions.closeFeedbackDialog()}>Done</Button>
				</div>
			</div>
		{:else}
			<Dialog.Header>
				<Dialog.Title>Send feedback</Dialog.Title>
				<Dialog.Description>
					Report a bug, request a feature, or share a thought. This opens an issue on the
					super-review repository.
				</Dialog.Description>
			</Dialog.Header>

			<form onsubmit={submit} class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
				<!-- Kind selector -->
				<div class="grid grid-cols-3 gap-2">
					{#each KINDS as k (k.value)}
						{@const Icon = k.icon}
						<button
							type="button"
							onclick={() => (kind = k.value)}
							class={cn(
								'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm transition-colors',
								kind === k.value
									? 'border-primary bg-primary/10 text-foreground'
									: 'border-border text-muted-foreground hover:bg-accent'
							)}
							aria-pressed={kind === k.value}
						>
							<Icon class="size-4" />
							{k.label}
						</button>
					{/each}
				</div>

				<div class="space-y-1.5">
					<label for="feedback-title" class="text-xs font-medium text-muted-foreground">
						Title
					</label>
					<Input
						id="feedback-title"
						bind:value={title}
						placeholder="Short summary"
						maxlength={256}
						autocomplete="off"
					/>
				</div>

				<div class="space-y-1.5">
					<span class="text-xs font-medium text-muted-foreground">
						Description <span class="font-normal">(Markdown — paste or drop images to attach)</span>
					</span>
					<MarkdownComposer
						bind:value={body}
						placeholder="What happened? What did you expect? Steps to reproduce…"
						onkeydown={onComposerKeydown}
					/>
				</div>

				<!-- Screen recordings only — images go inline in the description above.
				     Video is the one thing the composer can't embed, so it stays as a
				     compact attach rather than the old full dropzone. -->
				<div class="space-y-1.5">
					{#if mediaDisabled}
						<p
							class="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground"
						>
							Attachment uploads aren't configured for this build, so you can only send text.
						</p>
					{:else}
						<FileDropZone
							accept={videoAccept}
							maxFiles={config?.maxFiles}
							fileCount={stagedVideos.length}
							maxFileSize={config?.maxVideoBytes}
							{onUpload}
							{onFileRejected}
							class="flex-row justify-start gap-2 px-3 py-2.5 text-left text-xs"
						>
							<FileVideo class="size-4 shrink-0" />
							<span>
								<span class="font-medium text-foreground">Attach a screen recording</span>
								— or drag and drop
								{#if config}
									<span class="text-muted-foreground"
										>(up to {displaySize(config.maxVideoBytes)})</span
									>
								{/if}
							</span>
						</FileDropZone>
					{/if}

					{#if stagedVideos.length > 0}
						<div class="space-y-1 pt-1">
							{#each stagedVideos as file, i (file.name + file.size + i)}
								<div
									class="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs"
								>
									<FileVideo class="size-4 shrink-0 text-muted-foreground" />
									<span class="line-clamp-1 flex-1">{file.name}</span>
									<span class="shrink-0 text-muted-foreground">{displaySize(file.size)}</span>
									<button
										type="button"
										onclick={() => removeStaged(i)}
										class="rounded p-0.5 hover:bg-accent"
										aria-label="Remove attachment"
									>
										<X class="size-3.5" />
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				{#if diagnostics}
					<p class="text-xs text-muted-foreground">
						The captured error details will be attached automatically.
					</p>
				{/if}

				{#if !config?.signedIn}
					<p class="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground">
						Sign in to GitHub (Repository → settings) to send feedback.
					</p>
				{/if}

				{#if error}
					<p
						class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
					>
						{error}
					</p>
				{/if}

				<Dialog.Footer>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onclick={() => actions.closeFeedbackDialog()}
					>
						Cancel
					</Button>
					<Button type="submit" size="sm" disabled={!canSubmit}>
						{submitting ? 'Sending…' : 'Send feedback'}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
