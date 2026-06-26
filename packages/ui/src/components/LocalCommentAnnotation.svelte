<script lang="ts" module>
	import type { LocalComment } from '@super-review/core/types';

	// Metadata Pierre carries on each local-comment line annotation. Mirrors
	// CommentMeta (PR comments): either an existing comment row (root or reply — the
	// component reconstructs the thread from the store) or the pending composer for
	// a brand-new one.
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
	import { onDestroy } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import { Button } from './ui/button';
	import { ShortcutHint } from './ui/shortcut-hint';
	import * as DropdownMenu from './ui/dropdown-menu';
	import MarkdownComposer from './MarkdownComposer.svelte';
	import ReplyComposer from './ReplyComposer.svelte';
	import CommentThreadActions from './CommentThreadActions.svelte';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app, composerKey, effectiveGithubAccount } from '@super-review/ui/store.svelte';
	import { formatRelative } from '@super-review/ui/utils';
	import { renderMarkdown } from '@super-review/ui/markdown';
	import '@super-review/ui/markdown.css';

	interface Props {
		meta: LocalCommentMeta;
	}

	let { meta }: Props = $props();

	// Reconstruct this comment's thread (root + replies) from the shared store. Each
	// comment in a thread is its own annotation pinned to the same line, so a single
	// instance needs to know whether it's the root, a reply, or the thread tail to
	// place the resolve control, badges and reply box correctly — mirroring how
	// CommentAnnotation threads PR comments. Sorted by createdAt, so the root (made
	// first) leads and replies follow in order.
	const threadComments = $derived.by(() => {
		if (meta.kind !== 'local-comment') return [];
		const c = meta.comment;
		const rootId = c.inReplyTo ?? c.id;
		return app.localComments
			.filter((x) => (x.inReplyTo ?? x.id) === rootId)
			.sort((a, b) => a.createdAt - b.createdAt);
	});
	const rootComment = $derived(
		threadComments[0] ?? (meta.kind === 'local-comment' ? meta.comment : null)
	);
	const isReply = $derived(meta.kind === 'local-comment' && meta.comment.inReplyTo != null);
	const isRoot = $derived(meta.kind === 'local-comment' && meta.comment.inReplyTo == null);
	const isThreadTail = $derived(
		meta.kind === 'local-comment' &&
			threadComments[threadComments.length - 1]?.id === meta.comment.id
	);

	// Render the comment body as GitHub-Flavored Markdown (sanitized in
	// markdown.ts) — same as the PR comment view — so local comments display
	// formatted text, links, and code rather than a raw string.
	let bodyHtml = $state('');
	$effect(() => {
		if (meta.kind !== 'local-comment') {
			bodyHtml = '';
			return;
		}
		const src = meta.comment.body;
		const theme = app.theme;
		if (!src.trim()) {
			bodyHtml = '';
			return;
		}
		let cancelled = false;
		void renderMarkdown(src, theme)
			.then((h) => {
				if (!cancelled) bodyHtml = h;
			})
			.catch(() => {
				if (!cancelled) bodyHtml = '';
			});
		return () => {
			cancelled = true;
		};
	});

	const composerState = $derived.by(() => {
		if (meta.kind !== 'local-composer') return null;
		const key = composerKey(meta.filePath, meta.side, meta.line);
		return { key, value: app.localComposers[key] ?? null };
	});

	// Resolution is thread-level: the root carries it, and the whole thread reads as
	// resolved (and dims) when the root is resolved.
	const resolved = $derived(rootComment?.resolvedAt != null);
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

	// Inline edit state for this comment's body. Uses the same MarkdownComposer as
	// the new-comment composer below — and as the PR view — so editing gets the
	// full Write/Preview editor. Whether THIS comment is being edited is derived
	// from the shared `openCommentEditor` key, so an edit and a reply can't be open
	// at the same time (opening either closes the other).
	let editDraft = $state('');
	let editSubmitting = $state(false);
	const editKey = $derived(meta.kind === 'local-comment' ? `edit:local:${meta.comment.id}` : '');
	const editing = $derived(editKey !== '' && app.openCommentEditor === editKey);

	function startEdit(body: string): void {
		editDraft = body;
		actions.setOpenCommentEditor(editKey);
	}
	function cancelEdit(): void {
		editDraft = '';
		actions.setOpenCommentEditor(null);
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

	// Inline reply, rendered on the thread tail via the shared ReplyComposer (same
	// component the PR thread uses). Agents reply via the CLI; this is the human
	// path. The viewer's avatar fronts the slim prompt when signed in. Open state is
	// the shared `openCommentEditor` key, so a reply and an edit are mutually
	// exclusive.
	const viewerAvatar = $derived(effectiveGithubAccount()?.avatarUrl ?? '');
	const replyKey = $derived(rootComment ? `reply:local:${rootComment.id}` : '');
	const replyExpanded = $derived(replyKey !== '' && app.openCommentEditor === replyKey);
	function replyTo(body: string): Promise<boolean> {
		if (meta.kind !== 'local-comment') return Promise.resolve(false);
		const root = rootComment ?? meta.comment;
		return actions.submitLocalReply(meta.comment.path, root.id, body);
	}

	// If this comment is unmounted while it owns the shared open-editor key (e.g.
	// switching files mid-edit in single-file layout), clear the key so it doesn't
	// reopen an empty editor when the comment remounts.
	onDestroy(() => {
		if (app.openCommentEditor === editKey || app.openCommentEditor === replyKey) {
			actions.setOpenCommentEditor(null);
		}
	});
</script>

<div
	class={[
		'local-comment-annotation',
		isReply && 'is-reply',
		(resolved || outdated) && 'is-resolved'
	]}
>
	{#if meta.kind === 'local-comment'}
		{@const c = meta.comment}
		<article class="comment">
			{#if c.author.kind === 'agent' && c.author.harness}
				<!-- Agent author (e.g. a CLI reply) shows its harness logo as the avatar,
				     matching how resolutions and session cards identify a harness. -->
				<div class="avatar avatar-harness" title={c.author.name}>
					<HarnessLogo harness={c.author.harness} size={20} />
				</div>
			{:else if c.author.avatarUrl}
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
					<!-- Outdated/Resolved are thread-level — shown once, on the root. -->
					{#if outdated && isRoot}
						<span
							class="outdated-tag"
							title="The line this comment was left on is no longer in the diff"
						>
							Outdated
						</span>
					{/if}
					{#if resolved && isRoot}
						<span class="resolved-tag"><Check class="size-3" /> Resolved</span>
					{/if}
					<div class="ml-auto flex shrink-0 items-center gap-0.5">
						<!-- Resolve lives in the thread-actions bar below (PR-style), not
						     here, so it sits in the same place on PR and local comments. -->
						<!-- Edit is the viewer's own comment — a first-class action, hidden
						     while already editing (mirrors the PR comment view). -->
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
							<DropdownMenu.Content align="end" class="w-auto!">
								<DropdownMenu.Item onSelect={() => actions.copyCommentPrompt(c.id)}>
									<Copy class="size-3.5" />
									Copy as prompt
								</DropdownMenu.Item>
								<!-- Delete sits in its own group, separated from the
								     non-destructive actions above. -->
								<DropdownMenu.Separator />
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
						<MarkdownComposer
							bind:value={editDraft}
							placeholder="Edit comment…"
							disabled={editSubmitting}
							autofocus
							onkeydown={(e) => onEditKeydown(e, c.id)}
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
				{:else if bodyHtml}
					<!-- bodyHtml is sanitized with DOMPurify in markdown.ts before it reaches here -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="markdown-body text">{@html bodyHtml}</div>
				{:else}
					<p class="text">{c.body}</p>
				{/if}
				{#if resolved && isRoot && c.resolvedBy}
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
		{#if isThreadTail}
			<ReplyComposer
				expanded={replyExpanded}
				onexpand={() => actions.setOpenCommentEditor(replyKey)}
				oncollapse={() => actions.setOpenCommentEditor(null)}
				onsubmit={replyTo}
				avatarUrl={viewerAvatar}
				replyingTo={rootComment?.author.name}
			/>
			<!-- Thread-level controls below the whole conversation, in the same place
			     (and the same component) as the PR comment view. -->
			<CommentThreadActions
				{resolved}
				onCopyThread={() => actions.copyLocalThreadPrompt((rootComment ?? c).id)}
				onToggleResolved={() =>
					resolved
						? actions.unresolveLocalComment((rootComment ?? c).id)
						: actions.resolveLocalComment((rootComment ?? c).id)}
			/>
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
				<span>New comment</span>
			</div>
			<MarkdownComposer
				bind:value={composer.draft}
				placeholder="Leave a comment on this line…"
				disabled={composer.submitting}
				autofocus
				onkeydown={onKeydown}
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
	/* Replies stack as their own annotation rows beneath the root; dropping their
	   top border leaves a single 1px rule between rows (the previous row's bottom
	   border), so a thread reads as one stack rather than a set of boxed comments —
	   mirroring the PR thread. */
	.local-comment-annotation.is-reply {
		border-top: none;
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
	/* Agent author: square-ish so the harness logo isn't clipped into a circle. */
	.avatar-harness {
		display: grid;
		place-items: center;
		border-radius: 4px;
		background: transparent;
		overflow: hidden;
	}
	/* The 1fr grid track defaults to min-width: auto, so without this the inline
	   edit composer's wide Carta toolbar refuses to shrink and overflows the host
	   instead of collapsing into the "…" menu (the block-level new-comment
	   composer isn't affected). */
	.body {
		min-width: 0;
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
	/* The rendered-markdown body carries its own block spacing (paragraph/list
	   margins). `pre-wrap` — kept above for the raw-text fallback, which must
	   preserve real newlines — would turn marked's inter-tag newlines into visible
	   blank lines, so render markdown with normal whitespace collapsing. */
	.markdown-body.text {
		white-space: normal;
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
