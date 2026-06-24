<script lang="ts" module>
	import type { LocalComment } from '@shared/types';

	// Metadata Pierre carries on each local-comment line annotation. Mirrors
	// CommentMeta (PR comments) but for the local, flat comments: either an
	// existing comment row or the pending composer for a brand-new one.
	export type LocalCommentMeta =
		| {
				kind: 'local-comment';
				comment: LocalComment;
				// Whether the line this comment is pinned to is gone from the current
				// diff — the working tree changed under it. Computed by DiffFileSection
				// from the rendered patch (contextual, so it's stamped on the meta rather
				// than persisted on the comment). Undefined when the diff isn't loaded
				// yet, in which case the UI shows no badge rather than a false "outdated".
				isOutdated?: boolean;
		  }
		| { kind: 'local-composer'; filePath: string; line: number; side: 'LEFT' | 'RIGHT' };
</script>

<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import { Button } from './ui/button';
	import { ShortcutHint } from './ui/shortcut-hint';
	import * as DropdownMenu from './ui/dropdown-menu';
	import { Textarea } from './ui/textarea';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app, composerKey } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';

	interface Props {
		meta: LocalCommentMeta;
	}

	let { meta }: Props = $props();

	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	$effect(() => {
		textareaEl?.focus();
	});

	const composerState = $derived.by(() => {
		if (meta.kind !== 'local-composer') return null;
		const key = composerKey(meta.filePath, meta.side, meta.line);
		return { key, value: app.localComposers[key] ?? null };
	});

	const resolved = $derived(meta.kind === 'local-comment' && meta.comment.resolvedAt != null);
	// Stamped on the meta by DiffFileSection: the anchored line is gone from the
	// current diff (the working tree changed under the comment).
	const outdated = $derived(meta.kind === 'local-comment' && meta.isOutdated === true);

	function submit(): void {
		if (composerState) void actions.submitLocalComposer(composerState.key);
	}
	function cancel(): void {
		if (composerState) actions.cancelLocalComposer(composerState.key);
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

	// Inline edit state for this comment's body. Local comments are plain text, so
	// the editor is a plain Textarea (matching the new-comment composer below)
	// rather than the PR view's Markdown editor.
	let editing = $state(false);
	let editDraft = $state('');
	let editSubmitting = $state(false);
	let editTextareaEl = $state<HTMLTextAreaElement | null>(null);
	$effect(() => {
		if (editing) editTextareaEl?.focus();
	});

	function startEdit(body: string): void {
		editing = true;
		editDraft = body;
	}
	function cancelEdit(): void {
		editing = false;
		editDraft = '';
	}
	async function saveEdit(id: string): Promise<void> {
		if (editSubmitting) return;
		const body = editDraft.trim();
		if (!body) return;
		editSubmitting = true;
		const ok = await actions.editLocalComment(id, body);
		editSubmitting = false;
		if (ok) cancelEdit();
	}
	function onEditKeydown(e: KeyboardEvent, id: string): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void saveEdit(id);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// Copy-as-prompt with a brief checkmark confirmation on the button.
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;
	function copyComment(id: string): void {
		void actions.copyCommentPrompt(id);
		copied = true;
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1500);
	}
</script>

<div class={['local-comment-annotation', (resolved || outdated) && 'is-resolved']}>
	{#if meta.kind === 'local-comment'}
		{@const c = meta.comment}
		<article class="comment">
			{#if c.author.avatarUrl}
				<img class="avatar" src={c.author.avatarUrl} alt={c.author.name} width="20" height="20" />
			{:else}
				<!-- Anonymous "You" (not signed into GitHub) has no avatar — show an
				     initialed placeholder so the layout still reads like the PR view. -->
				<div class="avatar avatar-fallback" aria-hidden="true">
					{(c.author.name || '?').charAt(0).toUpperCase()}
				</div>
			{/if}
			<div class="body">
				<header>
					<span class="author">{c.author.name}</span>
					<span class="time">{formatRelative(c.createdAt)}</span>
					{#if outdated}
						<span
							class="outdated-tag"
							title="The line this comment was left on is no longer in the diff"
						>
							Outdated
						</span>
					{/if}
					{#if resolved}
						<span class="resolved-tag"><Check class="size-3" /> Resolved</span>
					{/if}
					<div class="ml-auto flex shrink-0 items-center gap-0.5">
						<button
							type="button"
							class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
							title={resolved ? 'Unresolve' : 'Resolve'}
							onclick={() =>
								resolved ? actions.unresolveLocalComment(c.id) : actions.resolveLocalComment(c.id)}
						>
							{#if resolved}
								<RotateCcw class="size-3.5" />
							{:else}
								<Check class="size-3.5" />
							{/if}
						</button>
						<button
							type="button"
							class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
							title="Copy as prompt"
							onclick={() => copyComment(c.id)}
						>
							{#if copied}
								<Check class="size-3.5" style="color: var(--color-success);" />
							{:else}
								<Copy class="size-3.5" />
							{/if}
						</button>
						<!-- Edit is the viewer's own comment — a first-class action next to
						     Copy, hidden while already editing (mirrors the PR comment view). -->
						{#if !editing}
							<button
								type="button"
								class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
								title="Edit comment"
								aria-label="Edit comment"
								onclick={() => startEdit(c.body)}
							>
								<Pencil class="size-3.5" />
							</button>
						{/if}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
								aria-label="More actions"
							>
								<MoreHorizontal class="size-4" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Item
									variant="destructive"
									onSelect={() => actions.deleteLocalComment(c.id)}
								>
									<Trash2 class="size-3.5" />
									Delete
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				</header>
				{#if editing}
					<form
						class="composer edit-composer"
						onsubmit={(e) => {
							e.preventDefault();
							void saveEdit(c.id);
						}}
					>
						<Textarea
							bind:ref={editTextareaEl}
							class="resize-y"
							bind:value={editDraft}
							onkeydown={(e) => onEditKeydown(e, c.id)}
							disabled={editSubmitting}
							rows={3}
						/>
						<div class="composer-footer">
							<div class="actions">
								<Button variant="ghost" size="sm" type="button" onclick={cancelEdit}>
									Cancel <ShortcutHint>esc</ShortcutHint>
								</Button>
								<Button
									variant="default"
									size="sm"
									type="submit"
									disabled={!editDraft.trim() || editSubmitting}
								>
									{editSubmitting ? 'Saving…' : 'Save'}
									<ShortcutHint>⌘⏎</ShortcutHint>
								</Button>
							</div>
						</div>
					</form>
				{:else}
					<p class="text">{c.body}</p>
				{/if}
				{#if resolved && c.resolvedBy}
					<footer class="resolution">
						{#if c.resolvedBy.kind === 'agent' && c.resolvedBy.harness}
							<HarnessLogo harness={c.resolvedBy.harness} size={14} />
						{:else if c.resolvedBy.kind === 'human' && c.resolvedBy.avatarUrl}
							<img
								class="resolver-avatar"
								src={c.resolvedBy.avatarUrl}
								alt={c.resolvedBy.name}
								width="14"
								height="14"
							/>
						{/if}
						<span>Resolved by {c.resolvedBy.name}</span>
						{#if c.resolvedSessionId}
							<button
								type="button"
								class="session-link"
								onclick={() => actions.openLinkedSession(c.resolvedSessionId!)}
							>
								View session
							</button>
						{/if}
					</footer>
				{/if}
			</div>
		</article>
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
				<span>New comment</span>
			</div>
			<Textarea
				bind:ref={textareaEl}
				class="resize-y"
				placeholder="Leave a comment on this line…"
				value={composer.draft}
				oninput={(e) =>
					actions.setLocalComposerDraft(
						composerState!.key,
						(e.target as HTMLTextAreaElement).value
					)}
				onkeydown={onKeydown}
				disabled={composer.submitting}
				rows={3}
			/>
			<div class="composer-footer">
				<div class="actions">
					<Button variant="ghost" size="sm" type="button" onclick={cancel}>
						Cancel <ShortcutHint>esc</ShortcutHint>
					</Button>
					<Button
						variant="default"
						size="sm"
						type="submit"
						disabled={!composer.draft.trim() || composer.submitting}
					>
						{composer.submitting ? 'Saving…' : 'Comment'}
						<ShortcutHint>⌘⏎</ShortcutHint>
					</Button>
				</div>
			</div>
		</form>
	{/if}
</div>

<style>
	.local-comment-annotation {
		padding: 8px 12px;
		background: hsl(var(--muted) / 0.4);
		border-top: 1px solid hsl(var(--border));
		border-bottom: 1px solid hsl(var(--border));
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
	}
	/* Resolved comments stay visible but de-emphasized (kept-and-greyed). */
	.local-comment-annotation.is-resolved .text,
	.local-comment-annotation.is-resolved .author,
	.local-comment-annotation.is-resolved .time {
		opacity: 0.55;
	}
	.comment {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		align-items: start;
	}
	.avatar {
		width: 20px;
		height: 20px;
		border-radius: 999px;
		margin-top: 2px;
		flex-shrink: 0;
	}
	/* Initialed placeholder for an anonymous author (no GitHub avatar). */
	.avatar-fallback {
		display: grid;
		place-items: center;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		color: hsl(var(--muted-foreground));
		background: hsl(var(--muted));
		text-transform: uppercase;
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
	.resolved-tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		padding: 2px 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
	}
	/* "Outdated": the anchored line is gone from the current diff. Mirrors the PR
	   comment view's badge (and the comments sidebar) — warning-toned, pill-shaped. */
	.outdated-tag {
		display: inline-flex;
		align-items: center;
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		padding: 2px 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
		color: var(--color-warning);
	}
	.text {
		font-size: 13px;
		line-height: 1.45;
		margin: 4px 0 6px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.resolution {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: hsl(var(--muted-foreground));
		margin-top: 2px;
	}
	.resolver-avatar {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		flex-shrink: 0;
	}
	.session-link {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.session-link:hover {
		opacity: 0.8;
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	/* The inline edit editor replaces the comment body, so give it the same
	   vertical rhythm the rendered text had. */
	.edit-composer {
		margin: 4px 0 6px;
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
</style>
