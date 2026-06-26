<script lang="ts">
	import Reply from '@lucide/svelte/icons/reply';
	import MarkdownComposer from './MarkdownComposer.svelte';
	import { Button } from './ui/button';
	import { ShortcutHint } from './ui/shortcut-hint';

	// GitHub-style reply affordance shared by the PR (CommentAnnotation) and local
	// (LocalCommentAnnotation) comment threads, so the two look and behave
	// identically: a slim one-line prompt (viewer avatar + "Reply…") that expands
	// into the full MarkdownComposer with Cancel/Reply actions.
	//
	// Expansion is *controlled* by the parent (`expanded` + onexpand/oncollapse) so
	// the open state can be coordinated app-wide — only one inline editor (a reply
	// or an edit box) is ever open at a time. This component still owns the draft.
	interface Props {
		// Whether the editor is expanded (parent-controlled).
		expanded: boolean;
		onexpand: () => void;
		oncollapse: () => void;
		// Posts the reply. Resolves true on success so the box clears and collapses;
		// false leaves the draft intact so the user can retry.
		onsubmit: (body: string) => Promise<boolean>;
		// Viewer's avatar shown next to the slim prompt; omitted when signed out.
		avatarUrl?: string;
		// Author of the thread root, shown in the expanded editor's "Replying to …"
		// header. Omitted → no header.
		replyingTo?: string;
		// Placeholder for the slim prompt and, separately, the expanded editor.
		promptPlaceholder?: string;
		editorPlaceholder?: string;
		// Submit-button copy (idle / in-flight).
		submitLabel?: string;
		submittingLabel?: string;
	}
	let {
		expanded,
		onexpand,
		oncollapse,
		onsubmit,
		avatarUrl = '',
		replyingTo,
		promptPlaceholder = 'Reply…',
		editorPlaceholder = 'Write a reply…',
		submitLabel = 'Reply',
		submittingLabel = 'Posting…'
	}: Props = $props();

	let draft = $state('');
	let submitting = $state(false);

	// Drop the draft whenever the box is collapsed — including when the parent
	// collapses it because another editor opened, so a stale draft never lingers.
	$effect(() => {
		if (!expanded) draft = '';
	});

	async function submit(): Promise<void> {
		const body = draft.trim();
		if (!body || submitting) return;
		submitting = true;
		const ok = await onsubmit(body);
		submitting = false;
		if (ok) oncollapse();
	}
	function onKeydown(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			oncollapse();
		}
	}
</script>

{#if expanded}
	<!-- Expanded reply: the same MarkdownComposer the new-comment composer uses, so
	     a reply gets the full Write/Preview editor. -->
	<form
		class="composer reply-composer"
		onsubmit={(e) => {
			e.preventDefault();
			void submit();
		}}
	>
		{#if replyingTo}
			<div class="composer-header">
				<Reply class="size-3.5 text-muted-foreground" />
				<span>Replying to {replyingTo}</span>
			</div>
		{/if}
		<MarkdownComposer
			bind:value={draft}
			placeholder={editorPlaceholder}
			disabled={submitting}
			autofocus
			onkeydown={onKeydown}
		/>
		<div class="composer-footer">
			<div class="actions">
				<Button variant="ghost" size="sm" type="button" onclick={oncollapse}>
					Cancel <ShortcutHint>esc</ShortcutHint>
				</Button>
				<Button variant="default" size="sm" type="submit" disabled={!draft.trim() || submitting}>
					{submitting ? submittingLabel : submitLabel}
					<ShortcutHint>⌘⏎</ShortcutHint>
				</Button>
			</div>
		</div>
	</form>
{:else}
	<!-- Slim prompt: the viewer's avatar next to a one-line box. Clicking (or
	     focusing) it expands the full editor. -->
	<div class="reply-prompt">
		{#if avatarUrl}
			<img class="reply-avatar" src={avatarUrl} alt="" width="20" height="20" />
		{/if}
		<input
			class="reply-box"
			type="text"
			placeholder={promptPlaceholder}
			readonly
			onfocus={onexpand}
			onclick={onexpand}
		/>
	</div>
{/if}

<style>
	.composer {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	/* Expanded reply editor, set off from the comment it replies to. */
	.reply-composer {
		margin-top: 8px;
	}
	.composer-header {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 12px;
		color: hsl(var(--muted-foreground));
	}
	.composer-footer {
		display: flex;
		justify-content: flex-end;
		align-items: center;
	}
	.actions {
		display: flex;
		gap: 4px;
	}
	.reply-prompt {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		margin-top: 8px;
	}
	.reply-avatar {
		border-radius: 999px;
		flex-shrink: 0;
	}
	.reply-box {
		flex: 1;
		min-width: 0;
		padding: 6px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--color-foreground);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		outline: none;
		cursor: text;
	}
	.reply-box::placeholder {
		color: var(--color-muted-foreground);
	}
	.reply-box:focus {
		border-color: var(--color-ring);
	}
</style>
