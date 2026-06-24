<script lang="ts">
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
	import {
		actions,
		app,
		composerKey,
		effectiveGithubAccount,
		prThreadCollapsed
	} from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import { renderMarkdown } from '$lib/markdown';
	import '$lib/markdown.css';
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
				// Bottom of a multi-line selection (the range end). Undefined for a
				// single-line comment. The composer renders at `line` (the start).
				endLine?: number;
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

	// Whether this comment's thread renders collapsed. Collapse is thread-level:
	// resolved/outdated threads default collapsed and the single toggle lives on the
	// root. When collapsed the root shows just a header (no body) and the replies
	// disappear entirely — `hiddenReply` drops them from the DOM.
	const collapsed = $derived(meta.kind === 'comment' && prThreadCollapsed(meta.comment));
	const hiddenReply = $derived(collapsed && isReply);

	// The viewer's avatar for the GitHub-style reply prompt.
	const viewerAvatar = $derived(effectiveGithubAccount()?.avatarUrl ?? '');

	// Inline reply state. Kept local (not in pendingComposers). The prompt starts
	// as a slim one-line input; clicking it expands into the full MarkdownComposer
	// (Write/Preview + toolbar), GitHub-style, with Cancel/Reply actions.
	let replyDraft = $state('');
	let replySubmitting = $state(false);
	let replyExpanded = $state(false);

	function expandReply(): void {
		replyExpanded = true;
	}

	// Collapse back to the slim prompt and drop the draft. Used by Cancel and Esc.
	function collapseReply(): void {
		replyExpanded = false;
		replyDraft = '';
	}

	function onReplyKeydown(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submitReply();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			collapseReply();
		}
	}

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
		if (ok) {
			replyDraft = '';
			replyExpanded = false;
		}
	}

	function remove(comment: PRReviewComment): void {
		void actions.deleteComment(comment.id, comment.path);
	}

	// Inline edit state for this comment. Each comment row is its own component
	// instance, so a plain boolean tracks whether *this* one is being edited; the
	// draft is kept locally so typing doesn't churn the thread.
	let editing = $state(false);
	let editDraft = $state('');
	let editSubmitting = $state(false);

	function startEdit(comment: PRReviewComment): void {
		editing = true;
		editDraft = comment.body;
	}
	function cancelEdit(): void {
		editing = false;
		editDraft = '';
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

	// Copy this comment as an agent-ready prompt, with a brief checkmark confirm.
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;
	function copy(comment: PRReviewComment): void {
		void actions.copyPRCommentPrompt(comment.path, comment.id);
		copied = true;
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1500);
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
						<span class="time">{formatRelative(c.createdAt)}</span>
						<!-- Range label for a multi-line comment, on the root only — the
						     thread reads as anchored to the whole span. -->
						{#if isRoot && c.line != null && c.startLine != null && c.startLine !== c.line}
							<span class="range-tag">L{c.startLine}–L{c.line}</span>
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
						<!-- Right-aligned actions. Copy/overflow only show when expanded; the
						     single thread collapse toggle lives on the root and stays at the
						     far right in both states. -->
						<div class="ml-auto flex shrink-0 items-center gap-0.5">
							{#if !collapsed}
								<button
									type="button"
									class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
									title="Copy as prompt"
									onclick={() => copy(c)}
								>
									{#if copied}
										<Check class="size-3.5" style="color: var(--color-success);" />
									{:else}
										<Copy class="size-3.5" />
									{/if}
								</button>
								<!-- Edit is a first-class action on the viewer's own comment, so it
								     gets its own button next to Copy rather than living in the
								     overflow menu. Hidden while already editing. -->
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
								{#if c.url || c.canDelete}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger
											class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
											aria-label="Comment actions"
										>
											<MoreHorizontal class="size-4" />
										</DropdownMenu.Trigger>
										<DropdownMenu.Content align="end" class="w-auto!">
											{#if c.url}
												<DropdownMenu.Item onSelect={() => viewOnGithub(c)}>
													<Github class="size-3.5" />
													View on GitHub
												</DropdownMenu.Item>
											{/if}
											{#if c.canDelete}
												{#if c.url}
													<DropdownMenu.Separator />
												{/if}
												<DropdownMenu.Item variant="destructive" onSelect={() => remove(c)}>
													<Trash2 class="size-3.5" />
													Delete
												</DropdownMenu.Item>
											{/if}
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								{/if}
							{/if}
							{#if isRoot}
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
			{#if isThreadTail && !collapsed}
				{#if replyExpanded}
					<!-- Expanded reply: the same MarkdownComposer the new-comment composer
             uses, so a reply gets the full Write/Preview editor and toolbar. -->
					<form
						class="composer reply-composer"
						onsubmit={(e) => {
							e.preventDefault();
							void submitReply();
						}}
					>
						<MarkdownComposer
							bind:value={replyDraft}
							placeholder="Write a reply…"
							disabled={replySubmitting}
							autofocus
							onkeydown={onReplyKeydown}
						/>
						<div class="composer-footer">
							<div class="actions">
								<Button variant="ghost" size="sm" type="button" onclick={collapseReply}>
									Cancel <ShortcutHint>esc</ShortcutHint>
								</Button>
								<Button
									variant="default"
									size="sm"
									type="submit"
									disabled={!replyDraft.trim() || replySubmitting}
								>
									{replySubmitting ? 'Posting…' : 'Reply'}
									<ShortcutHint>⌘⏎</ShortcutHint>
								</Button>
							</div>
						</div>
					</form>
				{:else}
					<!-- GitHub-style reply affordance: the viewer's avatar next to a slim
             one-line prompt. Clicking (or focusing) it expands the full editor. -->
					<div class="reply-prompt">
						{#if viewerAvatar}
							<img class="reply-avatar" src={viewerAvatar} alt="" width="20" height="20" />
						{/if}
						<input
							class="reply-box"
							type="text"
							placeholder="Reply…"
							readonly
							onfocus={expandReply}
							onclick={expandReply}
						/>
					</div>
				{/if}
			{/if}
			{#if isThreadTail && c.threadId && !collapsed}
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
					<span>
						{#if composer.replyTo}
							Reply
						{:else if composer.endLine != null && composer.endLine > composer.line}
							New comment on lines {composer.line}–{composer.endLine}
						{:else}
							New comment
						{/if}
					</span>
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
	/* GitHub-style reply affordance: avatar + a slim one-line prompt that expands
     into the full MarkdownComposer when clicked. */
	.reply-prompt {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		margin-top: 4px;
	}
	/* Expanded reply editor — same composer as a new comment, with a little space
     above to set it off from the comment it replies to. */
	.reply-composer {
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
	.reply-box:disabled {
		opacity: 0.6;
	}
	/* Sits below the last comment, separated by a rule, so the resolve toggle
     reads as a thread-level action rather than part of that comment. Kept
     outside `.comment` so it stays full-opacity even when the thread is
     resolved (and its comments are dimmed). */
	.thread-actions {
		display: flex;
		margin-top: 6px;
		padding-top: 6px;
		border-top: 1px solid var(--color-border);
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
	/* Line-range label for a multi-line comment. Monospace to read as line numbers. */
	.range-tag {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 10px;
		color: hsl(var(--muted-foreground));
		background: var(--color-muted);
		padding: 1px 5px;
		border-radius: 999px;
		line-height: 1.4;
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
