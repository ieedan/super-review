<script lang="ts">
	import { onDestroy } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronsDownUp from '@lucide/svelte/icons/chevrons-down-up';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Copy from '@lucide/svelte/icons/copy';
	import Github from './icons/GithubIcon.svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from './ui/button';
	import { ShortcutHint } from './ui/shortcut-hint';
	import * as DropdownMenu from './ui/dropdown-menu';
	import DiffHunkSnippet from './DiffHunkSnippet.svelte';
	import MarkdownComposer from './MarkdownComposer.svelte';
	import ReplyComposer from './ReplyComposer.svelte';
	import CommentThreadActions from './CommentThreadActions.svelte';
	import {
		actions,
		app,
		composerKey,
		effectiveGithubAccount,
		prThreadCollapsed
	} from '@super-review/ui/store.svelte';
	import { formatRelative } from '@super-review/ui/utils';
	import { renderMarkdown } from '@super-review/ui/markdown';
	import '@super-review/ui/markdown.css';
	import type { PRReviewComment } from '@super-review/core/types';

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
		// Outdated threads pass their saved diff hunk here so the root comment renders
		// the code context inline (right under its header) — keeping outdated threads
		// on the exact same component and styling as a normal comment, just with a
		// snippet inside, rather than a bespoke layout.
		diffHunk?: string;
	}

	let { meta, diffHunk }: Props = $props();

	// Render the comment body as GitHub-Flavored Markdown (sanitized in
	// markdown.ts) so comments display formatted text, links, and code — matching
	// how the same markdown reads on GitHub — rather than as a raw string.
	let bodyHtml = $state('');
	$effect(() => {
		if (meta.kind !== 'comment') {
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
	const isRoot = $derived(meta.kind === 'comment' && !meta.comment.inReplyTo);
	const replyCount = $derived(Math.max(0, threadComments.length - 1));

	// A locally-inserted placeholder shown while its GitHub post is still in flight.
	// It has no real id/thread yet, so we render it read-only (a "Posting…" hint
	// instead of the time, no edit/delete/resolve/reply actions) until the server
	// comment replaces it.
	const optimistic = $derived(meta.kind === 'comment' && !!meta.comment.optimistic);

	// Whether this comment's thread renders collapsed. Collapse is thread-level:
	// resolved/outdated threads default collapsed and the single toggle lives on the
	// root. When collapsed the root shows just a header (no body) and the replies
	// disappear entirely — `hiddenReply` drops them from the DOM.
	const collapsed = $derived(meta.kind === 'comment' && prThreadCollapsed(meta.comment));
	const hiddenReply = $derived(collapsed && isReply);

	// The viewer's avatar for the GitHub-style reply prompt.
	const viewerAvatar = $derived(effectiveGithubAccount()?.avatarUrl ?? '');

	// The thread root (first comment) — drives the reply target/label and the shared
	// open-editor key so a reply and an edit can't be open at once.
	const threadRoot = $derived(threadComments[0] ?? (meta.kind === 'comment' ? meta.comment : null));
	const replyKey = $derived(threadRoot ? `reply:pr:${threadRoot.id}` : '');
	const replyExpanded = $derived(replyKey !== '' && app.openCommentEditor === replyKey);

	function submit(): void {
		if (composerState) void actions.submitComposer(composerState.key);
	}

	function cancel(): void {
		if (composerState) actions.cancelComposer(composerState.key);
	}

	// Post a reply to the thread (via the shared ReplyComposer). Replies all hang
	// off the top-level comment, so we pass the root's id as `replyTo`.
	function replyTo(body: string): Promise<boolean> {
		if (meta.kind !== 'comment') return Promise.resolve(false);
		const c = meta.comment;
		const root = threadComments[0] ?? c;
		return actions.submitReply(c.path, root.id, body);
	}

	// If this comment is unmounted while it owns the shared open-editor key, clear it
	// so a remount doesn't reopen an empty editor (mirrors LocalCommentAnnotation).
	onDestroy(() => {
		if (app.openCommentEditor === editKey || app.openCommentEditor === replyKey) {
			actions.setOpenCommentEditor(null);
		}
	});

	function remove(comment: PRReviewComment): void {
		void actions.deleteComment(comment.id, comment.path);
	}

	// Inline edit state for this comment. The draft is kept locally so typing doesn't
	// churn the thread, but whether THIS comment is being edited is derived from the
	// shared `openCommentEditor` key — so an edit and a reply are mutually exclusive
	// (opening either closes the other).
	let editDraft = $state('');
	let editSubmitting = $state(false);
	const editKey = $derived(meta.kind === 'comment' ? `edit:pr:${meta.comment.id}` : '');
	const editing = $derived(editKey !== '' && app.openCommentEditor === editKey);

	function startEdit(comment: PRReviewComment): void {
		editDraft = comment.body;
		actions.setOpenCommentEditor(editKey);
	}
	function cancelEdit(): void {
		editDraft = '';
		actions.setOpenCommentEditor(null);
	}
	async function saveEdit(comment: PRReviewComment): Promise<void> {
		if (editSubmitting) return;
		const body = editDraft.trim();
		if (!body) return;
		editSubmitting = true;
		const ok = await actions.editReviewComment(comment.id, comment.path, body);
		editSubmitting = false;
		if (ok) cancelEdit();
	}
	function onEditKeydown(e: KeyboardEvent): void {
		if (meta.kind !== 'comment') return;
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void saveEdit(meta.comment);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// Open this comment on GitHub in the user's browser. `url` is the API-provided
	// permalink to the review comment.
	function viewOnGithub(comment: PRReviewComment): void {
		if (!comment.url) return;
		void window.api.shell.openExternal(comment.url);
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

{#if hiddenReply}
	<!-- A reply inside a collapsed thread is hidden entirely — the thread folds to
	     just its root header, and the single collapse toggle lives there. -->
{:else}
	<div class={['comment-annotation', isReply && 'is-reply']}>
		{#if meta.kind === 'comment'}
			{@const c = meta.comment}
			<article class="comment">
				<img class="avatar" src={c.authorAvatarUrl} alt={c.author} width="20" height="20" />
				<div class="body">
					<header>
						<span class="author">{c.author}</span>
						{#if optimistic}
							<span class="time">Posting…</span>
						{:else}
							<span class="time">{formatRelative(c.createdAt)}</span>
						{/if}
						<!-- "Outdated" mirrors GitHub: the anchored line/file is gone from the
					     current diff. It's independent of resolution — the resolved badge
					     below stays driven solely by `isResolved`. Shown once per thread
					     (on the root) like the resolved badge. -->
						{#if c.isOutdated && isRoot}
							<span class="outdated-tag">Outdated</span>
						{/if}
						{#if c.isResolved && isRoot}
							<span class="resolved-tag"><Check class="size-3" /> Resolved</span>
						{/if}
						<!-- When collapsed, the root keeps a reply count so the header reads
						     as a stand-in for the whole conversation. -->
						{#if collapsed && replyCount > 0}
							<span class="reply-count">
								{replyCount}
								{replyCount === 1 ? 'reply' : 'replies'}
							</span>
						{/if}
						<!-- Right-aligned actions. Edit/overflow only show when expanded; the
						     single thread collapse toggle lives on the root and stays at the
						     far right in both states. -->
						<div class="ml-auto flex shrink-0 items-center gap-0.5">
							{#if !collapsed && !optimistic}
								<!-- Edit is a first-class action on the viewer's own comment, so it
								     gets its own button rather than living in the overflow menu.
								     Hidden while already editing. -->
								{#if c.canDelete && !editing}
									<button
										type="button"
										class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
										title="Edit comment"
										aria-label="Edit comment"
										onclick={() => startEdit(c)}
									>
										<Pencil class="size-3.5" />
									</button>
								{/if}
								<DropdownMenu.Root>
									<DropdownMenu.Trigger
										class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
										aria-label="Comment actions"
									>
										<MoreHorizontal class="size-4" />
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="w-auto!">
										<DropdownMenu.Item onSelect={() => actions.copyPRCommentPrompt(c.path, c.id)}>
											<Copy class="size-3.5" />
											Copy as prompt
										</DropdownMenu.Item>
										{#if c.url}
											<DropdownMenu.Item onSelect={() => viewOnGithub(c)}>
												<Github class="size-3.5" />
												View on GitHub
											</DropdownMenu.Item>
										{/if}
										{#if c.canDelete}
											<!-- Delete sits in its own group, separated from the
											     non-destructive actions above. -->
											<DropdownMenu.Separator />
											<DropdownMenu.Item variant="destructive" onSelect={() => remove(c)}>
												<Trash2 class="size-3.5" />
												Delete
											</DropdownMenu.Item>
										{/if}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							{/if}
							{#if isRoot && !optimistic}
								<button
									type="button"
									class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
									title={collapsed ? 'Expand thread' : 'Collapse thread'}
									aria-label={collapsed ? 'Expand thread' : 'Collapse thread'}
									onclick={() => actions.toggleThreadCollapsed(c)}
								>
									{#if collapsed}
										<ChevronsUpDown class="size-3.5" />
									{:else}
										<ChevronsDownUp class="size-3.5" />
									{/if}
								</button>
							{/if}
						</div>
					</header>
					{#if !collapsed}
						<!-- Outdated threads: the saved code context renders here, under the
						     root's header, so the snippet reads as part of the comment. -->
						{#if isRoot && diffHunk}
							<div class="hunk-context">
								<DiffHunkSnippet hunk={diffHunk} path={c.path} />
							</div>
						{/if}
						{#if editing}
							<!-- Inline editor for the viewer's own comment — same MarkdownComposer
							     the new-comment/reply composers use, so editing gets the full
							     Write/Preview editor and toolbar. -->
							<form
								class="composer edit-composer"
								onsubmit={(e) => {
									e.preventDefault();
									void saveEdit(c);
								}}
							>
								<MarkdownComposer
									bind:value={editDraft}
									placeholder="Edit comment…"
									disabled={editSubmitting}
									autofocus
									onkeydown={onEditKeydown}
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
					{/if}
				</div>
			</article>
			{#if isThreadTail && !collapsed && !optimistic}
				<ReplyComposer
					expanded={replyExpanded}
					onexpand={() => actions.setOpenCommentEditor(replyKey)}
					oncollapse={() => actions.setOpenCommentEditor(null)}
					onsubmit={replyTo}
					avatarUrl={viewerAvatar}
					replyingTo={threadRoot?.author}
					replyingToAvatar={threadRoot?.authorAvatarUrl}
				/>
			{/if}
			{#if isThreadTail && !collapsed && !optimistic}
				<!-- Thread-level controls below the whole conversation. Copy-thread is
             always available; resolve needs a GraphQL thread id. -->
				<CommentThreadActions
					resolved={c.isResolved}
					canResolve={!!c.threadId}
					onToggleResolved={() => toggleResolved(c)}
					onCopyThread={() => actions.copyPRThreadPrompt(c.path, (threadComments[0] ?? c).id)}
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
					<span>{composer.replyTo ? 'Reply' : 'New comment'}</span>
				</div>
				<MarkdownComposer
					bind:value={composer.draft}
					placeholder={composer.replyTo ? 'Write a reply…' : 'Leave a comment on this line…'}
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
							{composer.submitting ? 'Posting…' : composer.replyTo ? 'Reply' : 'Comment'}
							<ShortcutHint>⌘⏎</ShortcutHint>
						</Button>
					</div>
				</div>
			</form>
		{/if}
	</div>
{/if}

<style>
	.comment-annotation {
		padding: 8px 12px;
		/* Muted fill separates comments from the diff/page. Must be OPAQUE: a
		   translucent fill blends with whatever's behind it, so the same comment
		   looked different over a diff row (inline comment) vs the page (outdated
		   thread). Mixing into `--color-card` gives one deterministic color
		   everywhere. (The original `hsl(var(--muted) / 0.4)` referenced an undefined
		   var — only `--color-muted` exists — so it never painted at all.) */
		background: color-mix(in srgb, var(--color-muted) 40%, var(--color-card));
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
	/* The 1fr grid track defaults to min-width: auto, so without this the inline
	   edit composer's wide Carta toolbar refuses to shrink and overflows the host
	   instead of collapsing into the "…" menu (the block-level new-comment/reply
	   composers aren't affected). */
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
	/* Reply count shown on a collapsed thread's root header. */
	.reply-count {
		color: hsl(var(--muted-foreground));
		font-size: 11px;
	}
	/* Outdated-thread code context, between the root header and the comment text.
	   Sits tight under the header (no extra top gap) so the header doesn't read as
	   over-padded. */
	.hunk-context {
		margin: 4px 0 8px;
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
	   blank lines and pile them on top of those margins, so render markdown with
	   normal whitespace collapsing. */
	.markdown-body.text {
		white-space: normal;
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	/* The inline edit editor takes the place of the comment body, so give it the
	   same vertical rhythm the rendered text had. */
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
