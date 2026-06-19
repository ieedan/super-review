<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import Github from './icons/GithubIcon.svelte';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as DropdownMenu from './ui/dropdown-menu';
	import HarnessLogo from './HarnessLogo.svelte';
	import ConversationPanel from './ConversationPanel.svelte';
	import { actions, app, isPRCommentContext } from '$lib/store.svelte';
	import FileIcon from './FileIcon.svelte';
	import { formatRelative } from '$lib/utils';
	import type { LocalComment, PRReviewComment } from '@shared/types';

	// In a PR view the sidebar lists GitHub review comments; everywhere else it
	// lists local comments. The two share the same chrome but different rows.
	const isPR = $derived(isPRCommentContext());

	// The Conversation tab (the PR's top-level discussion) only exists in a PR
	// context. Outside one, the sidebar is always the comments list, so the tab bar
	// is hidden and the remembered tab is ignored.
	const showTabs = $derived(isPR);
	const activeTab = $derived(showTabs ? app.commentsSidebarTab : 'comments');

	// ── Local comments ──
	// Newest first, but always sink resolved comments below the open ones so the
	// actionable feedback stays at the top.
	const localSorted = $derived(
		[...app.localComments].sort((a, b) => {
			const ar = a.resolvedAt != null ? 1 : 0;
			const br = b.resolvedAt != null ? 1 : 0;
			if (ar !== br) return ar - br;
			return b.createdAt - a.createdAt;
		})
	);

	// ── PR comments ──
	// Flatten the per-file map to root threads (a comment with no parent, pinned to
	// a line), each with its reply count. Resolved threads sink to the bottom.
	// Outdated roots have no live `line` but still belong here — they render with
	// their original line and an "Outdated" badge rather than being dropped.
	const prThreads = $derived.by(() => {
		const all = Object.values(app.prComments).flat();
		const roots = all.filter((c) => c.inReplyTo == null && (c.line != null || c.isOutdated));
		const withReplies = roots.map((root) => ({
			root,
			replies: all.filter((c) => c.inReplyTo === root.id).length
		}));
		return withReplies.sort((a, b) => {
			const ar = a.root.isResolved ? 1 : 0;
			const br = b.root.isResolved ? 1 : 0;
			if (ar !== br) return ar - br;
			return new Date(b.root.createdAt).getTime() - new Date(a.root.createdAt).getTime();
		});
	});

	const totalCount = $derived(isPR ? prThreads.length : app.localComments.length);
	const unresolvedCount = $derived(
		isPR
			? prThreads.filter((t) => !t.root.isResolved).length
			: app.localComments.filter((c) => c.resolvedAt == null).length
	);

	// Per-button "copied" feedback: the key of the button that was last copied,
	// cleared after a beat so the icon flips back from a checkmark to the copy icon.
	let copiedKey = $state<string | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;
	function flashCopied(key: string): void {
		copiedKey = key;
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copiedKey = null), 1500);
	}

	function copyAll(): void {
		if (isPR) void actions.copyAllUnresolvedPRComments();
		else void actions.copyAllUnresolvedComments();
		flashCopied('all');
	}

	function copyLocal(id: string): void {
		void actions.copyCommentPrompt(id);
		flashCopied(id);
	}
	function copyPR(path: string, id: number): void {
		void actions.copyPRCommentPrompt(path, id);
		flashCopied(`pr-${id}`);
	}

	// Open a PR review comment on GitHub in the browser (`url` is its permalink).
	function viewOnGithub(comment: PRReviewComment): void {
		if (!comment.url) return;
		void window.api.shell.openExternal(comment.url);
	}

	function lineLabel(c: LocalComment): string {
		return c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}-${c.endLine}`;
	}

	function fileName(path: string): string {
		const parts = path.split('/');
		return parts[parts.length - 1] || path;
	}

	function togglePRResolved(c: PRReviewComment): void {
		if (!c.threadId) return;
		void actions.setThreadResolved(c.threadId, !c.isResolved);
	}
</script>

<div class="flex h-full flex-col border-l border-border bg-card/40">
	<header class="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
		{#if showTabs}
			<!-- Tab switcher: line comments vs the PR's top-level conversation. -->
			<nav class="flex items-center gap-1" aria-label="Sidebar tabs">
				<button
					type="button"
					class={[
						'flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium',
						activeTab === 'comments'
							? 'text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					]}
					aria-pressed={activeTab === 'comments'}
					onclick={() => actions.setCommentsSidebarTab('comments')}
				>
					Comments
					{#if totalCount > 0}
						<span class="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
							{totalCount}
						</span>
					{/if}
				</button>
				<button
					type="button"
					class={[
						'rounded px-2 py-1 text-sm font-medium',
						activeTab === 'conversation'
							? 'text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					]}
					aria-pressed={activeTab === 'conversation'}
					onclick={() => actions.setCommentsSidebarTab('conversation')}
				>
					Conversation
				</button>
			</nav>
		{:else}
			<span class="text-sm font-semibold">Comments</span>
			{#if totalCount > 0}
				<span class="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
					{totalCount}
				</span>
			{/if}
		{/if}
		<div class="flex-1"></div>
		{#if activeTab === 'comments'}
			<button
				type="button"
				class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
				title="Copy all unresolved comments as a prompt"
				disabled={unresolvedCount === 0}
				onclick={copyAll}
			>
				{#if copiedKey === 'all'}
					<Check class="size-4" style="color: var(--color-success);" />
				{:else}
					<Copy class="size-4" />
				{/if}
			</button>
		{/if}
	</header>

	{#if activeTab === 'conversation'}
		<ConversationPanel />
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if totalCount === 0}
				<div class="grid h-full place-items-center p-6 text-center">
					<div>
						<p class="text-sm text-muted-foreground">No comments yet</p>
						<p class="mt-1 text-xs text-muted-foreground">
							{#if isPR}
								Click the <span class="font-medium">+</span> on a line to leave a PR review comment.
							{:else}
								Click the <span class="font-medium">+</span> on a line in the diff to leave one.
							{/if}
						</p>
					</div>
				</div>
			{:else if isPR}
				<ul>
					{#each prThreads as { root, replies } (root.id)}
						<li class="border-b border-border">
							<div
								role="button"
								tabindex="0"
								class={[
									'group w-full cursor-pointer px-3 py-2.5 text-left hover:bg-accent/50',
									(root.isResolved || root.isOutdated) && 'opacity-60'
								]}
								onclick={() => actions.revealPRComment(root.path, root.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										actions.revealPRComment(root.path, root.id);
									}
								}}
							>
								<div class="flex items-center gap-2">
									<img
										class="size-4 shrink-0 rounded-full"
										src={root.authorAvatarUrl}
										alt={root.author}
									/>
									<span class="truncate text-xs font-medium">{root.author}</span>
									<span class="shrink-0 text-[11px] text-muted-foreground">
										{formatRelative(root.createdAt)}
									</span>
									{#if root.isOutdated}
										<span
											class="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
											style="background: color-mix(in srgb, var(--color-warning) 15%, transparent); color: var(--color-warning);"
										>
											Outdated
										</span>
									{/if}
									{#if root.isResolved}
										<span
											class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
											style="background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success);"
										>
											<Check class="size-2.5" /> Resolved
										</span>
									{/if}
									<div class="flex-1"></div>
									<div class="flex shrink-0 items-center gap-0.5">
										{#if root.threadId}
											<button
												type="button"
												class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
												title={root.isResolved ? 'Unresolve' : 'Resolve'}
												onclick={(e) => {
													e.stopPropagation();
													togglePRResolved(root);
												}}
											>
												{#if root.isResolved}
													<RotateCcw class="size-3.5" />
												{:else}
													<Check class="size-3.5" />
												{/if}
											</button>
										{/if}
										<button
											type="button"
											class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
											title="Copy as prompt"
											onclick={(e) => {
												e.stopPropagation();
												copyPR(root.path, root.id);
											}}
										>
											{#if copiedKey === `pr-${root.id}`}
												<Check class="size-3.5" style="color: var(--color-success);" />
											{:else}
												<Copy class="size-3.5" />
											{/if}
										</button>
										{#if root.url || root.canDelete}
											<DropdownMenu.Root>
												<DropdownMenu.Trigger
													class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
													aria-label="More actions"
													onclick={(e: MouseEvent) => e.stopPropagation()}
												>
													<MoreHorizontal class="size-4" />
												</DropdownMenu.Trigger>
												<DropdownMenu.Content align="end" class="w-auto!">
													{#if root.url}
														<DropdownMenu.Item onSelect={() => viewOnGithub(root)}>
															<Github class="size-3.5" /> View on GitHub
														</DropdownMenu.Item>
													{/if}
													{#if root.canDelete}
														{#if root.url}
															<DropdownMenu.Separator />
														{/if}
														<DropdownMenu.Item
															variant="destructive"
															onSelect={() => actions.deleteComment(root.id, root.path)}
														>
															<Trash2 class="size-3.5" /> Delete
														</DropdownMenu.Item>
													{/if}
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										{/if}
									</div>
								</div>
								<div class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
									{#if app.showFileIcons}
										<FileIcon path={root.path} class="size-3.5 shrink-0" />
									{/if}
									<span class="truncate font-mono">{fileName(root.path)}</span>
									{#if (root.line ?? root.originalLine) != null}
										<span class="shrink-0">·</span>
										<span class="shrink-0 font-mono">L{root.line ?? root.originalLine}</span>
									{/if}
									{#if replies > 0}
										<span class="shrink-0">·</span>
										<span class="shrink-0">{replies} {replies === 1 ? 'reply' : 'replies'}</span>
									{/if}
								</div>
								<p class="mt-1 line-clamp-3 text-[13px] whitespace-pre-wrap">{root.body}</p>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<ul>
					{#each localSorted as c (c.id)}
						{@const resolved = c.resolvedAt != null}
						<li class="border-b border-border">
							<div
								role="button"
								tabindex="0"
								class={[
									'group w-full cursor-pointer px-3 py-2.5 text-left hover:bg-accent/50',
									resolved && 'opacity-60'
								]}
								onclick={() => actions.revealComment(c.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										actions.revealComment(c.id);
									}
								}}
							>
								<div class="flex items-center gap-2">
									<span class="truncate text-xs font-medium">{c.author.name}</span>
									<span class="shrink-0 text-[11px] text-muted-foreground">
										{formatRelative(c.createdAt)}
									</span>
									{#if resolved}
										<span
											class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
											style="background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success);"
										>
											<Check class="size-2.5" /> Resolved
										</span>
									{/if}
									<div class="flex-1"></div>
									<div class="flex shrink-0 items-center gap-0.5">
										<button
											type="button"
											class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
											title={resolved ? 'Unresolve' : 'Resolve'}
											onclick={(e) => {
												e.stopPropagation();
												if (resolved) actions.unresolveLocalComment(c.id);
												else actions.resolveLocalComment(c.id);
											}}
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
											onclick={(e) => {
												e.stopPropagation();
												copyLocal(c.id);
											}}
										>
											{#if copiedKey === c.id}
												<Check class="size-3.5" style="color: var(--color-success);" />
											{:else}
												<Copy class="size-3.5" />
											{/if}
										</button>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger
												class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
												aria-label="More actions"
												onclick={(e: MouseEvent) => e.stopPropagation()}
											>
												<MoreHorizontal class="size-4" />
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end">
												<DropdownMenu.Item
													variant="destructive"
													onSelect={() => actions.deleteLocalComment(c.id)}
												>
													<Trash2 class="size-3.5" /> Delete
												</DropdownMenu.Item>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									</div>
								</div>
								<div class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
									{#if app.showFileIcons}
										<FileIcon path={c.path} class="size-3.5 shrink-0" />
									{/if}
									<span class="truncate font-mono">{fileName(c.path)}</span>
									<span class="shrink-0">·</span>
									<span class="shrink-0 font-mono">{lineLabel(c)}</span>
								</div>
								<p class="mt-1 line-clamp-3 text-[13px] whitespace-pre-wrap">{c.body}</p>
								{#if resolved && c.resolvedBy}
									<div class="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
										{#if c.resolvedBy.kind === 'agent' && c.resolvedBy.harness}
											<HarnessLogo harness={c.resolvedBy.harness} size={12} />
										{/if}
										<span>Resolved by {c.resolvedBy.name}</span>
										{#if c.resolvedSessionId}
											<button
												type="button"
												class="underline underline-offset-2 hover:opacity-80"
												style="color: var(--color-primary);"
												onclick={(e) => {
													e.stopPropagation();
													actions.openLinkedSession(c.resolvedSessionId!);
												}}
											>
												View session
											</button>
										{/if}
									</div>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
