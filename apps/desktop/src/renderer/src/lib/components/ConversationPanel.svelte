<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import FileDiff from '@lucide/svelte/icons/file-diff';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import GitPullRequestClosed from '@lucide/svelte/icons/git-pull-request-closed';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Github from './icons/GithubIcon.svelte';
	import * as DropdownMenu from './ui/dropdown-menu';
	import MarkdownComposer from './MarkdownComposer.svelte';
	import MarkdownView from './MarkdownView.svelte';
	import { actions, app } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import type { PRConversationItem, PRConversationReview } from '@shared/types';

	// The PR whose conversation we're showing. In a `pr` review context that's
	// `activePR`; in the Branch tab with an open PR for the checked-out branch it's
	// `branchPR`. CommentsPanel only mounts this panel inside `isPRCommentContext()`,
	// so one of the two is always set.
	const pr = $derived(app.activePR ?? app.branchPR);

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

<div class="flex h-full min-h-0 flex-col">
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
					<div class="min-w-0 flex-1 rounded-lg border border-border p-3">
						<div class="flex items-center gap-2">
							<span class="truncate text-xs font-medium">{pr.author}</span>
							<span class="shrink-0 text-[11px] text-muted-foreground">
								opened {formatRelative(pr.createdAt)}
							</span>
						</div>
						<div class="mt-2">
							{#if pr.body.trim()}
								<MarkdownView src={pr.body} class="text-[13px]" />
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
							<div class="min-w-0 flex-1 rounded-lg border border-border p-3">
								<div class="flex items-center gap-2">
									<span class="truncate text-xs font-medium">{item.author}</span>
									<span class="shrink-0 text-[11px] text-muted-foreground">
										{formatRelative(item.createdAt)}
									</span>
									<div class="flex-1"></div>
									{#if item.url || item.canDelete}
										<DropdownMenu.Root>
											<DropdownMenu.Trigger
												class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
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
								<div class="mt-2">
									<MarkdownView src={item.body} class="text-[13px]" />
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
							<div class="min-w-0 flex-1 rounded-lg border border-border p-3">
								<div class="flex items-center gap-2">
									{#if item.state === 'approved'}
										<Check class="size-4 shrink-0" style="color: {meta.color};" />
									{:else if item.state === 'changes_requested'}
										<FileDiff class="size-4 shrink-0" style="color: {meta.color};" />
									{:else}
										<MessageSquare class="size-4 shrink-0 text-muted-foreground" />
									{/if}
									<span class="truncate text-xs font-medium">{item.author}</span>
									<span class="shrink-0 text-[11px]" style="color: {meta.color};">{meta.label}</span
									>
									<span class="shrink-0 text-[11px] text-muted-foreground">
										{formatRelative(item.createdAt)}
									</span>
								</div>
								{#if item.body.trim()}
									<div class="mt-2 border-l-2 border-border pl-3">
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
							<button
								type="button"
								class="flex min-h-6 min-w-0 flex-1 items-center gap-2 rounded text-left text-xs hover:text-foreground disabled:cursor-default disabled:hover:text-current"
								disabled={!item.url}
								onclick={() => item.url && viewOnGithub(item.url)}
								title={item.url ? 'View commit on GitHub' : undefined}
							>
								<span class="truncate">{item.message}</span>
								<div class="flex-1"></div>
								<span class="shrink-0 font-mono text-[11px] text-muted-foreground">
									{item.shortSha}
								</span>
							</button>
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
									<GitMerge class="size-3.5" style="color: var(--color-primary);" />
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
								<span class="truncate">{eventLabel(item)}</span>
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
