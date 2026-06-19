<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import FileDiff from '@lucide/svelte/icons/file-diff';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import GitPullRequestClosed from '@lucide/svelte/icons/git-pull-request-closed';
	import GitPullRequestDraft from '@lucide/svelte/icons/git-pull-request-draft';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Github from './icons/GithubIcon.svelte';
	import * as DropdownMenu from './ui/dropdown-menu';
	import MarkdownComposer from './MarkdownComposer.svelte';
	import Pencil from '@lucide/svelte/icons/pencil';
	import MarkdownView from './MarkdownView.svelte';
	import { actions, app, effectiveGithubAccount } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import { SvelteSet } from 'svelte/reactivity';
	import type { PRConversationItem, PRConversationReview } from '@shared/types';

	// Commit keys whose extended description is expanded (the "…" toggle), like
	// GitHub's expandable commit message.
	const expandedCommits = new SvelteSet<string>();
	function toggleCommit(key: string): void {
		if (expandedCommits.has(key)) expandedCommits.delete(key);
		else expandedCommits.add(key);
	}

	// The PR whose conversation we're showing. In a `pr` review context that's
	// `activePR`; in the Branch tab with an open PR for the checked-out branch it's
	// `branchPR`. CommentsPanel only mounts this panel inside `isPRCommentContext()`,
	// so one of the two is always set.
	const pr = $derived(app.activePR ?? app.branchPR);

	// Whenever this panel is visible for a PR, make sure the feed is loaded. Covers
	// reopening the app straight onto the Conversation tab (the persisted tab) and
	// switching PRs while the tab is open; `ensurePRConversationLoaded` is a no-op
	// when the current PR's feed is already loaded or loading.
	$effect(() => {
		if (pr) actions.ensurePRConversationLoaded();
	});

	// The PR author can edit the description (and toggle its task checkboxes). We
	// gate on author identity rather than full write access — which we don't track
	// here — and let the API reject anything it shouldn't allow.
	const canEditDescription = $derived(!!pr && effectiveGithubAccount()?.login === pr.author);

	// Inline edit state. At most one comment (or the description) is edited at a
	// time; `editing` holds the target and the draft is kept locally so typing
	// doesn't churn the feed.
	let editing = $state<{ kind: 'comment'; id: number } | { kind: 'description' } | null>(null);
	let editDraft = $state('');
	let editSubmitting = $state(false);

	function startEditComment(id: number, body: string): void {
		editing = { kind: 'comment', id };
		editDraft = body;
	}
	function startEditDescription(body: string): void {
		editing = { kind: 'description' };
		editDraft = body;
	}
	function cancelEdit(): void {
		editing = null;
		editDraft = '';
	}
	async function saveEdit(): Promise<void> {
		if (!editing || editSubmitting) return;
		const body = editDraft.trim();
		if (!body) return;
		editSubmitting = true;
		const ok =
			editing.kind === 'comment'
				? await actions.editConversationComment(editing.id, body)
				: await actions.editPRDescription(body);
		editSubmitting = false;
		if (ok) cancelEdit();
	}
	function onEditKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void saveEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// Inline style for a label chip, tinting GitHub's label color into a readable
	// pill (faint fill + accent border/text), matching how GitHub renders labels in
	// dark mode. `color` is the API's hex without a leading '#'.
	function labelChipStyle(color: string | undefined): string {
		if (!color) return '';
		const c = `#${color}`;
		return (
			`background: color-mix(in srgb, ${c} 18%, transparent);` +
			`border-color: color-mix(in srgb, ${c} 45%, transparent);` +
			`color: ${c};`
		);
	}

	// Composer state for posting a new top-level conversation comment.
	let draft = $state('');
	let submitting = $state(false);

	async function post(): Promise<void> {
		const body = draft.trim();
		if (!body || submitting) return;
		submitting = true;
		const ok = await actions.postConversationComment(body);
		submitting = false;
		if (ok) draft = '';
	}

	function onComposerKeydown(e: KeyboardEvent): void {
		// ⌘/Ctrl+Enter submits, matching the review-comment composer.
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void post();
		}
	}

	function viewOnGithub(url: string): void {
		if (url) void window.api.shell.openExternal(url);
	}

	// Status glyph + label + tint for the sticky header pill, matching how the PR
	// list renders it (green open, grey draft, red closed, purple merged). The
	// header fills the pill with the tint so it reads like GitHub's status badge.
	const prStatus = $derived.by(() => {
		if (!pr) return null;
		if (pr.merged) return { icon: GitMerge, color: 'var(--color-merged)', label: 'Merged' };
		if (pr.state === 'closed')
			return { icon: GitPullRequestClosed, color: 'var(--color-destructive)', label: 'Closed' };
		if (pr.draft)
			return {
				icon: GitPullRequestDraft,
				color: 'var(--color-muted-foreground)',
				label: 'Draft'
			};
		return { icon: GitPullRequest, color: 'var(--color-success)', label: 'Open' };
	});

	// GitHub's author-association badge text ("Owner", "Member", …). Returns '' for
	// associations we don't badge (NONE, mannequin, etc.), so the badge is skipped.
	function associationLabel(a: string | undefined): string {
		switch (a) {
			case 'OWNER':
				return 'Owner';
			case 'MEMBER':
				return 'Member';
			case 'COLLABORATOR':
				return 'Collaborator';
			case 'CONTRIBUTOR':
				return 'Contributor';
			case 'FIRST_TIME_CONTRIBUTOR':
			case 'FIRST_TIMER':
				return 'First-time contributor';
			default:
				return '';
		}
	}

	// Human label + accent color for a review verdict.
	const REVIEW_META: Record<PRConversationReview['state'], { label: string; color: string }> = {
		approved: { label: 'approved these changes', color: 'var(--color-success)' },
		changes_requested: { label: 'requested changes', color: 'var(--color-warning)' },
		commented: { label: 'reviewed', color: 'var(--color-muted-foreground, currentColor)' },
		dismissed: { label: 'review dismissed', color: 'var(--color-muted-foreground, currentColor)' }
	};

	// One-line label for a lightweight timeline event.
	function eventLabel(item: Extract<PRConversationItem, { kind: 'event' }>): string {
		switch (item.event) {
			case 'merged':
				return 'merged this pull request';
			case 'closed':
				return 'closed this pull request';
			case 'reopened':
				return 'reopened this pull request';
			case 'locked':
				return 'locked this conversation';
			case 'unlocked':
				return 'unlocked this conversation';
			case 'head_ref_force_pushed':
				return 'force-pushed the branch';
			case 'head_ref_deleted':
				return 'deleted the branch';
			case 'head_ref_restored':
				return 'restored the branch';
			case 'convert_to_draft':
				return 'marked this as a draft';
			case 'ready_for_review':
				return 'marked this ready for review';
			case 'labeled':
				return `added the ${item.detail ?? ''} label`;
			case 'unlabeled':
				return `removed the ${item.detail ?? ''} label`;
			case 'renamed':
				return `renamed this to “${item.detail ?? ''}”`;
			case 'review_requested':
				return `requested a review from ${item.detail ?? 'someone'}`;
			case 'review_request_removed':
				return `removed the review request for ${item.detail ?? 'someone'}`;
			case 'assigned':
				return `assigned ${item.detail ?? 'someone'}`;
			case 'unassigned':
				return `unassigned ${item.detail ?? 'someone'}`;
			default:
				return item.event.replace(/_/g, ' ');
		}
	}
</script>

{#snippet assocBadge(association: string | undefined)}
	{@const label = associationLabel(association)}
	{#if label}
		<span
			class="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground"
		>
			{label}
		</span>
	{/if}
{/snippet}

{#snippet editComposer()}
	<MarkdownComposer
		bind:value={editDraft}
		placeholder="Leave a comment"
		disabled={editSubmitting}
		onkeydown={onEditKeydown}
		autofocus
	/>
	<div class="mt-2 flex items-center justify-end gap-2">
		<button
			type="button"
			class="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
			onclick={cancelEdit}
		>
			Cancel
		</button>
		<button
			type="button"
			class="rounded-md px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
			style="background: var(--color-primary);"
			disabled={!editDraft.trim() || editSubmitting}
			onclick={saveEdit}
		>
			{editSubmitting ? 'Saving…' : 'Save'}
		</button>
	</div>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	{#if pr && prStatus}
		{@const Icon = prStatus.icon}
		<!-- Sticky status header: pinned above the scrolling feed so the PR's title,
		     status and branch line stay visible while reading the conversation. -->
		<div class="shrink-0 border-b border-border bg-background px-3 py-2">
			<h2 class="min-w-0 text-sm leading-snug font-semibold" title={pr.title}>
				<span class="line-clamp-2">
					{pr.title}
					<span class="font-normal text-muted-foreground">#{pr.number}</span>
				</span>
			</h2>
			<div class="mt-1.5 flex items-center gap-2 text-[11px]">
				<span
					class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium text-white"
					style="background: {prStatus.color};"
				>
					<Icon class="size-3" />
					{prStatus.label}
				</span>
				<span class="flex min-w-0 items-center gap-1 text-muted-foreground">
					<span class="truncate rounded bg-muted px-1 py-px font-mono">{pr.baseRef}</span>
					<span class="shrink-0">←</span>
					<span class="truncate rounded bg-muted px-1 py-px font-mono">{pr.headRef}</span>
				</span>
			</div>
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if !pr}
			<div class="grid h-full place-items-center p-6 text-center">
				<p class="text-sm text-muted-foreground">Open a pull request to see its conversation.</p>
			</div>
		{:else}
			<!-- A single timeline whose nodes (avatars / event icons) all sit on one
			     left rail. Each entry draws its own connector segment down to the next
			     node, so the line ends exactly at the last node regardless of how tall
			     the items above it are. `hasItems` decides whether the description's
			     connector is drawn. -->
			{@const hasItems = app.prConversation.length > 0}
			<div class="relative flex flex-col gap-3 px-3 py-3">
				<!-- PR description, the conversation's opening post. -->
				<div class="relative flex gap-3">
					{#if hasItems}
						<div
							class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
						></div>
					{/if}
					<img
						class="relative z-10 size-6 shrink-0 rounded-full"
						src={pr.authorAvatarUrl}
						alt={pr.author}
					/>
					<div
						class="comment-card group relative min-w-0 flex-1 rounded-lg border border-border bg-card"
					>
						<div
							class="comment-header flex min-h-6 items-center gap-1.5 rounded-t-[7px] border-b border-border px-3 py-1"
						>
							<span class="truncate text-xs font-medium">{pr.author}</span>
							{@render assocBadge(pr.authorAssociation)}
							<span class="shrink-0 text-[11px] text-muted-foreground">
								opened {formatRelative(pr.createdAt)}
							</span>
							<div class="flex-1"></div>
							{#if canEditDescription && editing?.kind !== 'description'}
								<button
									type="button"
									class="-mr-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
									title="Edit description"
									onclick={() => startEditDescription(pr.body)}
								>
									<Pencil class="size-3.5" />
								</button>
							{/if}
						</div>
						<div class="px-3 py-2">
							{#if editing?.kind === 'description'}
								{@render editComposer()}
							{:else if pr.body.trim()}
								<MarkdownView
									src={pr.body}
									class="text-[13px]"
									onToggleTask={canEditDescription
										? (s) => void actions.editPRDescription(s)
										: undefined}
								/>
							{:else}
								<p class="text-[13px] text-muted-foreground italic">No description provided.</p>
							{/if}
						</div>
					</div>
				</div>

				{#if app.loadingConversation && app.prConversation.length === 0}
					<div class="text-center text-xs text-muted-foreground">Loading conversation…</div>
				{/if}

				{#each app.prConversation as item, i (item.key)}
					{@const notLast = i < app.prConversation.length - 1}
					{#if item.kind === 'comment'}
						<div class="group relative flex gap-3">
							{#if notLast}
								<div
									class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
								></div>
							{/if}
							<img
								class="relative z-10 size-6 shrink-0 rounded-full"
								src={item.authorAvatarUrl}
								alt={item.author}
							/>
							<div
								class="comment-card relative min-w-0 flex-1 rounded-lg border border-border bg-card"
							>
								<div
									class="comment-header flex min-h-6 items-center gap-1.5 rounded-t-[7px] border-b border-border px-3 py-1"
								>
									<span class="truncate text-xs font-medium">{item.author}</span>
									{@render assocBadge(item.authorAssociation)}
									<span class="shrink-0 text-[11px] text-muted-foreground">
										commented {formatRelative(item.createdAt)}
									</span>
									<div class="flex-1"></div>
									{#if item.url || item.canDelete}
										<DropdownMenu.Root>
											<DropdownMenu.Trigger
												class="-mr-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
												aria-label="More actions"
											>
												<MoreHorizontal class="size-4" />
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end" class="w-auto!">
												{#if item.url}
													<DropdownMenu.Item onSelect={() => viewOnGithub(item.url)}>
														<Github class="size-3.5" /> View on GitHub
													</DropdownMenu.Item>
												{/if}
												{#if item.canDelete}
													{#if item.url}
														<DropdownMenu.Separator />
													{/if}
													<DropdownMenu.Item onSelect={() => startEditComment(item.id, item.body)}>
														<Pencil class="size-3.5" /> Edit
													</DropdownMenu.Item>
													<DropdownMenu.Item
														variant="destructive"
														onSelect={() => actions.deleteConversationComment(item.id)}
													>
														<Trash2 class="size-3.5" /> Delete
													</DropdownMenu.Item>
												{/if}
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									{/if}
								</div>
								<div class="px-3 py-2">
									{#if editing?.kind === 'comment' && editing.id === item.id}
										{@render editComposer()}
									{:else}
										<MarkdownView
											src={item.body}
											class="text-[13px]"
											onToggleTask={item.canDelete
												? (s) => void actions.editConversationComment(item.id, s)
												: undefined}
										/>
									{/if}
								</div>
							</div>
						</div>
					{:else if item.kind === 'review'}
						{@const meta = REVIEW_META[item.state]}
						<div class="relative flex gap-3">
							{#if notLast}
								<div
									class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
								></div>
							{/if}
							<img
								class="relative z-10 size-6 shrink-0 rounded-full"
								src={item.authorAvatarUrl}
								alt={item.author}
							/>
							<div
								class="comment-card relative min-w-0 flex-1 rounded-lg border border-border bg-card"
							>
								<div
									class={[
										'comment-header flex min-h-6 items-center gap-1.5 px-3 py-1',
										item.body.trim() ? 'rounded-t-[7px] border-b border-border' : 'rounded-[7px]'
									]}
								>
									{#if item.state === 'approved'}
										<Check class="size-3.5 shrink-0" style="color: {meta.color};" />
									{:else if item.state === 'changes_requested'}
										<FileDiff class="size-3.5 shrink-0" style="color: {meta.color};" />
									{:else}
										<MessageSquare class="size-3.5 shrink-0 text-muted-foreground" />
									{/if}
									<span class="truncate text-xs font-medium">{item.author}</span>
									{@render assocBadge(item.authorAssociation)}
									<span class="shrink-0 text-[11px]" style="color: {meta.color};">{meta.label}</span
									>
									<span class="shrink-0 text-[11px] text-muted-foreground">
										{formatRelative(item.createdAt)}
									</span>
								</div>
								{#if item.body.trim()}
									<div class="px-3 py-2">
										<MarkdownView src={item.body} class="text-[13px]" />
									</div>
								{/if}
							</div>
						</div>
					{:else if item.kind === 'commit'}
						<div class="relative flex gap-3">
							{#if notLast}
								<div
									class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
								></div>
							{/if}
							<div
								class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full bg-card text-muted-foreground"
							>
								<GitCommitHorizontal class="size-3.5" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex min-h-6 items-center gap-2 text-xs">
									{#if item.authorAvatarUrl}
										<img
											class="size-4 shrink-0 rounded-full"
											src={item.authorAvatarUrl}
											alt={item.author}
										/>
									{/if}
									<button
										type="button"
										class="truncate text-left hover:text-foreground disabled:hover:text-current"
										disabled={!item.url}
										onclick={() => item.url && viewOnGithub(item.url)}
										title={item.url ? `${item.author} · view commit on GitHub` : item.author}
									>
										{item.message}
									</button>
									{#if item.body}
										<button
											type="button"
											class={[
												'grid h-4 shrink-0 place-items-center rounded border border-border px-1 text-muted-foreground hover:bg-accent hover:text-foreground',
												expandedCommits.has(item.key) && 'bg-accent text-foreground'
											]}
											title="Toggle commit description"
											aria-expanded={expandedCommits.has(item.key)}
											onclick={() => toggleCommit(item.key)}
										>
											<MoreHorizontal class="size-3" />
										</button>
									{/if}
									<div class="flex-1"></div>
									{#if item.verified}
										<span
											class="inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-medium"
											style="border-color: color-mix(in srgb, var(--color-success) 50%, transparent); color: var(--color-success);"
										>
											<ShieldCheck class="size-2.5" /> Verified
										</span>
									{/if}
									<button
										type="button"
										class="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground disabled:hover:text-current"
										disabled={!item.url}
										onclick={() => item.url && viewOnGithub(item.url)}
									>
										{item.shortSha}
									</button>
								</div>
								{#if item.body && expandedCommits.has(item.key)}
									<pre
										class="mt-1 max-h-60 overflow-auto rounded border border-border bg-card px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{item.body}</pre>
								{/if}
							</div>
						</div>
					{:else}
						<!-- Lightweight timeline event. -->
						<div class="relative flex gap-3">
							{#if notLast}
								<div
									class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
								></div>
							{/if}
							<div
								class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full bg-card text-muted-foreground"
							>
								{#if item.event === 'merged'}
									<GitMerge class="size-3.5" style="color: var(--color-merged);" />
								{:else if item.event === 'closed'}
									<GitPullRequestClosed class="size-3.5" />
								{:else if item.event === 'labeled' || item.event === 'unlabeled'}
									<Tag class="size-3.5" />
								{:else}
									<CircleDot class="size-3.5" />
								{/if}
							</div>
							<div
								class="flex min-h-6 min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground"
							>
								<span class="font-medium text-foreground/80">{item.actor}</span>
								{#if item.event === 'labeled' || item.event === 'unlabeled'}
									<span class="shrink-0"
										>{item.event === 'labeled' ? 'added the' : 'removed the'}</span
									>
									<span
										class="inline-flex max-w-40 shrink-0 items-center truncate rounded-full border px-2 py-px text-[10px] font-medium"
										style={labelChipStyle(item.labelColor)}
									>
										{item.detail}
									</span>
									<span class="shrink-0">label</span>
								{:else}
									<span class="truncate">{eventLabel(item)}</span>
								{/if}
								<div class="flex-1"></div>
								<span class="shrink-0">{formatRelative(item.createdAt)}</span>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>

	{#if pr}
		<!-- Composer pinned to the bottom for posting a new conversation comment. -->
		<div class="shrink-0 border-t border-border p-2">
			<MarkdownComposer
				bind:value={draft}
				placeholder="Leave a comment"
				disabled={submitting}
				onkeydown={onComposerKeydown}
			/>
			<div class="mt-2 flex items-center justify-end">
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
					style="background: var(--color-primary);"
					disabled={!draft.trim() || submitting}
					onclick={post}
				>
					{submitting ? 'Posting…' : 'Comment'}
					<kbd
						class="rounded bg-primary-foreground/15 px-1 py-0.5 text-[10px] leading-none font-normal"
					>
						⌘⏎
					</kbd>
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	/* The comment box's header bar is tinted a step away from the card body so the
	   two read as distinct, GitHub-style. The same color fills the speech-bubble
	   tail, which sits on the header. */
	.comment-card {
		--bubble: color-mix(in srgb, var(--color-muted) 55%, var(--color-card));
	}
	.comment-header {
		background: var(--bubble);
	}

	/* GitHub-style speech-bubble tail: a triangle on the comment box's left edge
	   pointing back at the author avatar in the rail gutter. The ::before is a
	   border-colored triangle; the ::after is a bubble-colored fill 1px smaller and
	   re-centered (margin-top) so the border shows as a 1px outline on BOTH
	   diagonals, then nudged 1px right (margin-right) to overlap the box's left
	   border so the tail merges into the header. Level with the avatar (~12px from
	   the card top). */
	.comment-card::before,
	.comment-card::after {
		content: '';
		position: absolute;
		top: 4px;
		right: 100%;
		width: 0;
		height: 0;
		border: 8px solid transparent;
		border-right-color: var(--color-border);
	}
	.comment-card::after {
		border-width: 7px;
		border-right-color: var(--bubble);
		margin-top: 1px;
		margin-right: -1px;
	}
</style>
