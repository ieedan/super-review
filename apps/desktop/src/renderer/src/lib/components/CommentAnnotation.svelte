<script lang="ts">
	import { Check, MessageSquare, MoreHorizontal, Trash2 } from 'lucide-svelte';
	import { Button } from './ui/button';
	import * as DropdownMenu from './ui/dropdown-menu';
	import { Textarea } from './ui/textarea';
	import { actions, app, composerKey, effectiveGithubAccount } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import type { PRReviewComment } from '@shared/types';

	// Metadata stamped onto every DiffLineAnnotation we feed @pierre/diffs.
	// Lets this single component render either an existing comment row or the
	// pending composer for a brand-new comment / reply.
	export type CommentMeta =
		| { kind: 'comment'; comment: PRReviewComment }
		| {
				kind: 'composer';
				filePath: string;
				line: number;
				side: 'LEFT' | 'RIGHT';
				replyTo?: number;
		  };

	interface Props {
		meta: CommentMeta;
	}

	let { meta }: Props = $props();

	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	// Focus the textarea as soon as the composer mounts.
	$effect(() => {
		textareaEl?.focus();
	});

	const composerState = $derived.by(() => {
		if (meta.kind !== 'composer') return null;
		const key = composerKey(meta.filePath, meta.side, meta.line);
		return { key, value: app.pendingComposers[key] ?? null };
	});

	// All comments in this comment's thread (root + replies), in display order.
	// GitHub flattens replies so each carries the top-level comment's id in
	// `inReplyTo`; the root points at itself. We use this to anchor the
	// resolve/unresolve control to the LAST comment, so it renders once per
	// thread, below the whole conversation — not on an individual comment.
	const threadComments = $derived.by(() => {
		if (meta.kind !== 'comment') return [];
		const c = meta.comment;
		const rootId = c.inReplyTo ?? c.id;
		return (app.prComments[c.path] ?? []).filter((x) => (x.inReplyTo ?? x.id) === rootId);
	});
	const isThreadTail = $derived(
		meta.kind === 'comment' && threadComments[threadComments.length - 1]?.id === meta.comment.id
	);
	// A reply (not the thread root) gets a divider above it so stacked comments
	// in a thread read as distinct entries rather than one run-on block.
	const isReply = $derived(meta.kind === 'comment' && !!meta.comment.inReplyTo);

	// The viewer's avatar for the GitHub-style reply prompt.
	const viewerAvatar = $derived(effectiveGithubAccount()?.avatarUrl ?? '');

	// Inline reply state. Kept local (not in pendingComposers) so the box stays
	// an input in place — no swap to a separate composer row, no layout shift.
	let replyDraft = $state('');
	let replySubmitting = $state(false);

	function submit(): void {
		if (composerState) void actions.submitComposer(composerState.key);
	}

	function cancel(): void {
		if (composerState) actions.cancelComposer(composerState.key);
	}

	// Post a reply to the thread. Replies all hang off the top-level comment, so
	// we pass the root's id as `replyTo`.
	async function submitReply(): Promise<void> {
		if (meta.kind !== 'comment') return;
		const body = replyDraft.trim();
		if (!body || replySubmitting) return;
		const c = meta.comment;
		const root = threadComments[0] ?? c;
		replySubmitting = true;
		const ok = await actions.submitReply(c.path, root.id, body);
		replySubmitting = false;
		if (ok) replyDraft = '';
	}

	function remove(comment: PRReviewComment): void {
		void actions.deleteComment(comment.id, comment.path);
	}

	function toggleResolved(comment: PRReviewComment): void {
		// No threadId means GraphQL didn't map this comment to a thread (e.g. a
		// freshly created comment not yet refetched) — nothing to toggle.
		if (!comment.threadId) return;
		void actions.setThreadResolved(comment.threadId, !comment.isResolved);
	}

	function onKeydown(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			submit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		}
	}
</script>

<div class={['comment-annotation', isReply && 'is-reply']}>
	{#if meta.kind === 'comment'}
		{@const c = meta.comment}
		<!-- The thread root is the comment with no parent. Resolve controls and the
         "Resolved" badge live there so they appear once per thread, not on
         every reply (replies in a resolved thread are just dimmed). -->
		{@const isRoot = !c.inReplyTo}
		<article class="comment">
			<img class="avatar" src={c.authorAvatarUrl} alt={c.author} width="20" height="20" />
			<div class="body">
				<header>
					<span class="author">{c.author}</span>
					<span class="time">{formatRelative(c.createdAt)}</span>
					{#if c.isResolved && isRoot}
						<span class="resolved-tag"><Check class="size-3" /> Resolved</span>
					{/if}
					{#if c.canDelete}
						<!-- Overflow menu, top-right. Keeps the destructive Delete action
                 tucked away rather than sitting prominently in the footer. -->
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="more-trigger ml-auto grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
								aria-label="Comment actions"
							>
								<MoreHorizontal class="size-4" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Item variant="destructive" onSelect={() => remove(c)}>
									<Trash2 class="size-3.5" />
									Delete
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				</header>
				<p class="text">{c.body}</p>
			</div>
		</article>
		{#if isThreadTail}
			<!-- GitHub-style reply affordance: the viewer's avatar next to an inline
           input. Stays an input in place (no swap to a textarea) — submit on
           Enter. -->
			<form
				class="reply-prompt"
				onsubmit={(e) => {
					e.preventDefault();
					void submitReply();
				}}
			>
				{#if viewerAvatar}
					<img class="reply-avatar" src={viewerAvatar} alt="" width="20" height="20" />
				{/if}
				<input
					class="reply-box"
					type="text"
					placeholder="Reply…"
					bind:value={replyDraft}
					disabled={replySubmitting}
				/>
			</form>
		{/if}
		{#if isThreadTail && c.threadId}
			<!-- Thread-level control: renders below the last comment so it sits
           under the whole conversation, mirroring GitHub's resolve bar. -->
			<div class="thread-actions">
				<Button variant="outline" size="sm" onclick={() => toggleResolved(c)}>
					{#if !c.isResolved}
						<Check class="size-3.5" />
					{/if}
					{c.isResolved ? 'Unresolve' : 'Resolve'}
				</Button>
			</div>
		{/if}
	{:else if composerState?.value}
		{@const composer = composerState.value}
		<form
			class="composer"
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<div class="composer-header">
				<MessageSquare class="size-3.5 text-muted-foreground" />
				<span>{composer.replyTo ? 'Reply' : 'New comment'}</span>
			</div>
			<Textarea
				bind:ref={textareaEl}
				class="resize-y"
				placeholder={composer.replyTo ? 'Write a reply…' : 'Leave a comment on this line…'}
				value={composer.draft}
				oninput={(e) =>
					actions.setComposerDraft(composerState!.key, (e.target as HTMLTextAreaElement).value)}
				onkeydown={onKeydown}
				disabled={composer.submitting}
				rows={3}
			/>
			<div class="composer-footer">
				<div class="actions">
					<Button variant="ghost" size="sm" type="button" onclick={cancel}>
						Cancel <kbd class="kbd">esc</kbd>
					</Button>
					<Button
						variant="default"
						size="sm"
						type="submit"
						disabled={!composer.draft.trim() || composer.submitting}
					>
						{composer.submitting ? 'Posting…' : composer.replyTo ? 'Reply' : 'Comment'}
						<kbd class="kbd">⌘⏎</kbd>
					</Button>
				</div>
			</div>
		</form>
	{/if}
</div>

<style>
	.comment-annotation {
		padding: 8px 12px;
		background: hsl(var(--muted) / 0.4);
		border-top: 1px solid hsl(var(--border));
		border-bottom: 1px solid hsl(var(--border));
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
	}
	/* Divider between stacked comments in a thread: replies (every comment after
     the root) get a rule above them so each reads as a distinct entry. */
	.comment-annotation.is-reply {
		border-top: 1px solid var(--color-border);
	}
	.comment {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		align-items: start;
	}
	/* GitHub-style reply affordance: avatar + an inline input that posts a reply
     directly (no swap to a separate composer). */
	.reply-prompt {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		margin-top: 10px;
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
	}
	.reply-box::placeholder {
		color: var(--color-muted-foreground);
	}
	.reply-box:focus {
		border-color: var(--color-ring);
	}
	.reply-box:disabled {
		opacity: 0.6;
	}
	/* Sits below the last comment, separated by a rule, so the resolve toggle
     reads as a thread-level action rather than part of that comment. Kept
     outside `.comment` so it stays full-opacity even when the thread is
     resolved (and its comments are dimmed). */
	.thread-actions {
		display: flex;
		margin-top: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--color-border);
	}
	.resolved-tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		padding: 2px 6px;
		border-radius: 999px;
		/* Use the defined `--color-success` token (a full hsl() value); color-mix
       gives it a translucent fill — same approach used in DiffFileSection. */
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
	}
	.avatar {
		border-radius: 999px;
		margin-top: 2px;
	}
	.body header {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 12px;
	}
	.author {
		font-weight: 600;
	}
	.time {
		color: hsl(var(--muted-foreground));
		font-size: 11px;
	}
	.text {
		font-size: 13px;
		line-height: 1.45;
		margin: 4px 0 6px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: 6px;
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
	.kbd {
		font-family: inherit;
		font-size: 10px;
		line-height: 1;
		padding: 2px 4px;
		border-radius: 4px;
		background: hsl(var(--foreground) / 0.08);
		opacity: 0.7;
	}
</style>
