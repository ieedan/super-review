<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Cloud from '@lucide/svelte/icons/cloud';
	import Eye from '@lucide/svelte/icons/eye';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import GitFork from '@lucide/svelte/icons/git-fork';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import GitPullRequestClosed from '@lucide/svelte/icons/git-pull-request-closed';
	import GitPullRequestDraft from '@lucide/svelte/icons/git-pull-request-draft';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import { Button, buttonVariants } from './ui/button';
	import * as Popover from './ui/popover';
	import * as Command from './ui/command';
	import * as UnderlineTabs from './ui/underline-tabs';
	import { confirmDelete } from './ui/confirm-delete-dialog';
	import {
		actions,
		app,
		isReadOnlyView,
		isViewingOtherBranch,
		viewedBranch,
		viewedPRLabel
	} from '@super-review/ui/store.svelte';
	import { cn, formatRelative } from '@super-review/ui/utils';
	import type { BranchInfo, PRSource, PRSummary } from '@super-review/core/types';

	let filter = $state('');
	let tab = $state<'branches' | 'prs'>('branches');
	// Track whether we've kicked off a PR fetch for the current popover session
	// so switching to the tab loads once rather than on every render.
	let prsRequested = $state(false);

	// Reset PR fetch tracking when the active repo changes — the next visit to
	// the Pull Requests tab should refetch for the new repo.
	let lastRepoId = $state<string | null>(null);
	$effect(() => {
		const id = app.activeRepo?.id ?? null;
		if (id !== lastRepoId) {
			lastRepoId = id;
			prsRequested = false;
		}
	});

	function reset(): void {
		filter = '';
		tab = 'branches';
		prsRequested = false;
	}

	// Reset whenever the picker closes. Keying off `open` (rather than the
	// popover's onOpenChange) covers every close path: checking out a branch,
	// opening a PR, and the context-menu/dialog actions all close the picker by
	// setting `open` directly, which never fires onOpenChange.
	$effect(() => {
		if (!app.branchPickerOpen) reset();
	});

	// Kick off the PR fetch once per popover session, deduped via `prsRequested`.
	// Shared by the tab click and the hover-to-preload handler so hovering the
	// Pull Requests tab warms the list before you click it — SvelteKit-style
	// preload-on-hover.
	function preloadPRs(): void {
		if (prsRequested || !app.activeRepo) return;
		prsRequested = true;
		void actions.loadPRs();
	}

	function selectTab(value: string): void {
		tab = value === 'prs' ? 'prs' : 'branches';
		// The two lists filter different things; carrying the query across is
		// confusing, so start each tab fresh.
		filter = '';
		if (tab === 'prs') preloadPRs();
	}

	async function checkout(b: BranchInfo): Promise<void> {
		app.branchPickerOpen = false;
		// A branch checked out in another worktree can't be checked out here (git
		// refuses: "already used by worktree"), so enter that worktree instead —
		// the app re-targets its checkout and the branch behaves like any other,
		// uncommitted changes included. From inside a worktree the main
		// checkout's branch carries the repo's own path, so selecting it lands
		// back home through the same call.
		if (b.worktreePath && !b.current) {
			await actions.enterWorktree(b.worktreePath);
			return;
		}
		if (app.activeRepo?.activeWorktreePath) {
			// Switching to a branch no worktree owns: leave the worktree first so
			// the dirty check (and any stash prompt) concerns the main checkout's
			// tree, not the agent's in-progress work.
			await actions.exitWorktree();
			if (b.name === app.currentBranch) return;
		}
		await actions.requestBranchSwitch(b.name);
	}

	// Right-click a branch row: pop the native OS context menu and dispatch the
	// chosen action. Copy goes straight through; delete routes via the confirm
	// dialog so the remote-delete checkbox/warning still applies.
	// A remote-only branch has no local ref, so read-only viewing (and the
	// trigger's "viewed" comparison) must go through its "origin/feat" tracking
	// ref, which resolves; a local branch views by its own name.
	function viewRef(b: BranchInfo): string {
		return b.isRemote && b.upstream ? b.upstream : b.name;
	}

	async function showContextMenu(e: MouseEvent, b: BranchInfo): Promise<void> {
		e.preventDefault();
		const action = await window.api.menu.showBranchContextMenu({
			name: b.name,
			// Delete acts on a local branch; a remote-only branch has none to remove.
			canDelete: !b.current && !b.isRemote,
			// Offer read-only viewing for any branch except the one already shown.
			canView: viewRef(b) !== viewedBranch()
		});
		if (action === 'copy') {
			await actions.copyToClipboard(b.name);
		} else if (action === 'delete') {
			requestDelete(b);
		} else if (action === 'view') {
			app.branchPickerOpen = false;
			await actions.viewBranchReadOnly(viewRef(b));
		}
	}

	// Confirm before deleting. When the branch also lives on a remote we surface
	// an opt-in checkbox to delete it there too, plus a warning since that can
	// strip collaborators of unpushed work. onConfirm throws on failure so the
	// dialog stays open and the error toast explains why.
	function requestDelete(b: BranchInfo): void {
		app.branchPickerOpen = false;
		const hasRemote = !!b.upstream;
		confirmDelete({
			title: `Delete branch "${b.name}"?`,
			description: `This deletes the local branch "${b.name}". This can't be undone.`,
			checkbox: hasRemote
				? {
						label: `Also delete ${b.upstream} on the remote`,
						description: "Collaborators who track this branch may lose work that isn't pushed.",
						default: false
					}
				: undefined,
			confirm: { text: 'Delete branch' },
			onConfirm: async ({ checked }) => {
				const ok = await actions.deleteBranch(b.name, { deleteRemote: checked });
				if (!ok) throw new Error('delete failed');
			}
		});
	}

	async function openPR(pr: PRSummary): Promise<void> {
		app.branchPickerOpen = false;
		await actions.checkoutPR(pr);
	}

	// Right-click a PR row: pop the native menu and dispatch. "View Read-Only"
	// reviews the PR's diff without checking it out; copy/open act on the PR we
	// already hold, so they need no extra round-trip.
	async function showPRContextMenu(e: MouseEvent, pr: PRSummary): Promise<void> {
		e.preventDefault();
		const action = await window.api.menu.showPRContextMenu({
			number: pr.number,
			canView: app.viewPR?.number !== pr.number
		});
		if (action === 'view') {
			app.branchPickerOpen = false;
			await actions.viewPRReadOnly(pr);
		} else if (action === 'copyUrl') {
			await actions.copyToClipboard(pr.url);
		} else if (action === 'openOnGitHub') {
			await window.api.shell.openExternal(pr.url);
		}
	}

	function openCreate(): void {
		app.branchPickerOpen = false;
		actions.openCreateBranchDialog();
	}

	type Row = { kind: 'heading'; label: string } | { kind: 'branch'; branch: BranchInfo };

	// Flatten the default + recent sections (and their headings) into a single
	// list of rows so the whole popover scrolls together rather than the recent
	// list scrolling on its own. Filtering is applied here (rather than via
	// Command's built-in matcher) so headings can be dropped alongside their
	// section and the row model stays the single source of truth.
	const rows = $derived.by(() => {
		const defaultName = app.activeRepo?.defaultBranch;
		const needle = filter.trim().toLowerCase();
		const matches = (b: BranchInfo): boolean =>
			needle === '' || b.name.toLowerCase().includes(needle);
		let defaultBranch: BranchInfo | null = null;
		const recent: BranchInfo[] = [];
		const remote: BranchInfo[] = [];
		for (const b of app.branches) {
			if (defaultName && b.name === defaultName && !b.isRemote && !defaultBranch) {
				defaultBranch = matches(b) ? b : null;
			} else if (matches(b)) {
				(b.isRemote ? remote : recent).push(b);
			}
		}
		const result: Row[] = [];
		if (defaultBranch) {
			result.push({ kind: 'heading', label: 'Default Branch' });
			result.push({ kind: 'branch', branch: defaultBranch });
		}
		if (recent.length > 0) {
			result.push({ kind: 'heading', label: 'Recent Branches' });
			for (const b of recent) result.push({ kind: 'branch', branch: b });
		}
		// Branches that only live on a remote (no local checkout yet). Selecting
		// one checks it out, which creates a local tracking branch.
		if (remote.length > 0) {
			result.push({ kind: 'heading', label: 'Remote Branches' });
			for (const b of remote) result.push({ kind: 'branch', branch: b });
		}
		return result;
	});

	// PR rows, filtered by title / number / author / branch. A trailing
	// `loadMore` sentinel row is appended whenever more pages remain — once it
	// scrolls into view it triggers the next fetch.
	type PRRow = { kind: 'pr'; pr: PRSummary } | { kind: 'loadMore' };
	const prRows = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		const matches = (p: PRSummary): boolean =>
			needle === '' ||
			p.title.toLowerCase().includes(needle) ||
			String(p.number).includes(needle) ||
			p.author.toLowerCase().includes(needle) ||
			p.headRef.toLowerCase().includes(needle);
		const result: PRRow[] = app.prs.filter(matches).map((pr) => ({ kind: 'pr', pr }) as PRRow);
		// Only offer "load more" for the unfiltered list — paging makes no sense
		// while a local filter is narrowing what's already fetched.
		if (app.prsHasMore && needle === '') result.push({ kind: 'loadMore' });
		return result;
	});

	// The status glyph + tint for a PR: green open, grey draft, red closed,
	// purple merged.
	function prStatus(pr: PRSummary): {
		icon: typeof GitMerge;
		class: string;
		label: string;
	} {
		if (pr.merged) return { icon: GitMerge, class: 'text-merged', label: 'Merged' };
		if (pr.state === 'closed')
			return {
				icon: GitPullRequestClosed,
				class: 'text-destructive',
				label: 'Closed'
			};
		if (pr.draft)
			return {
				icon: GitPullRequestDraft,
				class: 'text-muted-foreground',
				label: 'Draft'
			};
		return { icon: GitPullRequest, class: 'text-success', label: 'Open' };
	}

	// Svelte action: fire a "load more" when the sentinel row scrolls into view.
	// With the list no longer virtualized the sentinel is always mounted, so we
	// watch it with an IntersectionObserver (rooted at the scroll container)
	// rather than firing on mount, which would eagerly page in everything. The
	// store guards against overlapping and redundant loads.
	function loadMoreOnVisible(node: HTMLElement) {
		const root = node.closest<HTMLElement>('[data-slot="command-list"]');
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) void actions.loadMorePRs();
			},
			{ root, rootMargin: '120px' }
		);
		io.observe(node);
		return { destroy: () => io.disconnect() };
	}

	// Re-derive on `nowTick` so the relative timestamps stay live while the
	// popover is open.
	function relativeFor(b: BranchInfo): string | null {
		void app.nowTick;
		if (!b.lastCommitAt) return null;
		return formatRelative(new Date(b.lastCommitAt).toISOString());
	}

	function prRelative(pr: PRSummary): string {
		void app.nowTick;
		return formatRelative(pr.updatedAt);
	}

	// A fork exposes its parent repo's PRs too — show the source switcher then.
	const hasUpstream = $derived(!!(app.activeRepo?.upstreamOwner && app.activeRepo?.upstreamRepo));

	function sourceLabel(source: PRSource): string {
		const r = app.activeRepo;
		if (!r) return '';
		return source === 'upstream'
			? `${r.upstreamOwner}/${r.upstreamRepo}`
			: `${r.githubOwner}/${r.githubRepo}`;
	}

	// The trigger labels whatever is shown in the UI: a read-only view target (a
	// branch, or a PR's head branch) when one is set, otherwise the checked-out
	// branch. While reviewing read-only, an eye glyph signals it; otherwise mirror
	// the current branch's PR status glyph + tint, falling back to a branch icon.
	const triggerIcon = $derived(
		isReadOnlyView()
			? { icon: Eye, class: 'text-muted-foreground', label: 'Viewing read-only' }
			: app.branchPR
				? prStatus(app.branchPR)
				: { icon: GitBranch, class: 'text-muted-foreground', label: 'Branch' }
	);

	// The text shown in the trigger: a viewed PR's head branch, else the viewed
	// or checked-out branch.
	const triggerLabel = $derived(viewedPRLabel() ?? viewedBranch() ?? 'no branch');
</script>

<Popover.Root bind:open={app.branchPickerOpen}>
	<Popover.Trigger
		disabled={!app.activeRepo}
		class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'font-normal')}
	>
		{@const TriggerIcon = triggerIcon.icon}
		<TriggerIcon class={cn('size-3.5', triggerIcon.class)} aria-label={triggerIcon.label} />
		<span>
			{triggerLabel}
		</span>
		<!-- Inside a linked worktree the branch is real and writable, but lives in
		     a different checkout than the repo's own — surface that. -->
		{#if app.activeRepo?.activeWorktreePath && !isReadOnlyView()}
			<span
				class="rounded bg-foreground/10 px-1 py-0.5 text-[10px] leading-none font-medium text-muted-foreground"
				title={app.activeRepo.activeWorktreePath}
			>
				worktree
			</span>
		{/if}
		<ChevronDown class="size-3.5 text-muted-foreground" />
	</Popover.Trigger>
	<Popover.Content align="start" class="w-[26rem] p-0">
		<UnderlineTabs.Root value={tab} onValueChange={selectTab} class="gap-0 pt-1.5">
			<!-- Underline tabs across the top of the picker. The active underline
			     aligns with the list's bottom border; gap-0 keeps the search box
			     tucked right under it. -->
			<UnderlineTabs.List class="px-2">
				<UnderlineTabs.Trigger value="branches" class="text-sm">Branches</UnderlineTabs.Trigger>
				<UnderlineTabs.Trigger value="prs" class="text-sm" onmouseenter={preloadPRs}>
					Pull Requests
				</UnderlineTabs.Trigger>
			</UnderlineTabs.List>

			<Command.Root shouldFilter={false}>
				<!-- Sticky header: filter input on the left; "New branch" appears on
             the Branches tab only. Both stay visible while the list scrolls. -->
				<div class="flex items-center gap-2 border-b border-border p-2">
					<div
						class="flex h-8 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2"
					>
						<Search class="size-3.5 shrink-0 text-muted-foreground" />
						<CommandPrimitive.Input
							bind:value={filter}
							placeholder={tab === 'prs' ? 'Filter pull requests…' : 'Filter…'}
							class="flex h-full w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
						/>
					</div>
					{#if tab === 'branches'}
						<Button size="sm" class="h-8 shrink-0 gap-1.5" onclick={openCreate}>
							<Plus class="size-3.5" />
							New branch
						</Button>
					{/if}
				</div>

				<!-- Render only the active tab's body. bits-ui keeps inactive
				     Tabs.Content panels mounted (just hidden), which would leave the
				     other tab's Command.Items in this shared Command.Root and let the
				     filter input's arrow keys land on rows you can't see. -->
				{#if tab === 'branches'}
					<Command.List class="max-h-[320px]">
						{#if app.branches.length === 0}
							<div class="px-3 py-6 text-center text-xs text-muted-foreground">No branches</div>
						{:else if rows.length === 0}
							<div class="px-3 py-6 text-center text-xs text-muted-foreground">No matches</div>
						{:else}
							<Command.Group class="p-1">
								<!-- Rows render straight into the list (no virtualization) so
								     bits-ui Command can move selection through them and scroll the
								     highlighted row into view on arrow keys. `content-visibility`
								     keeps the off-screen rows cheap to lay out on a busy repo. -->
								{#each rows as row (row.kind === 'heading' ? `h:${row.label}` : `b:${row.branch.name}`)}
									{#if row.kind === 'heading'}
										<div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
											{row.label}
										</div>
									{:else}
										{@const b = row.branch}
										{@const isViewed = viewRef(b) === viewedBranch()}
										{@const drifted = isViewingOtherBranch()}
										<Command.Item
											value={b.name}
											onSelect={() => checkout(b)}
											oncontextmenu={(e) => showContextMenu(e, b)}
											class={cn(
												'flex items-center gap-2 [content-visibility:auto] [contain-intrinsic-size:auto_28px]',
												isViewed && 'bg-accent/60'
											)}
										>
											<!-- The row you're looking at gets an eye while reviewing a
											     branch read-only; the checked-out branch keeps the green
											     branch glyph. With no drift these are the same row. -->
											{#if drifted && isViewed}
												<Eye class="size-3.5 text-foreground" aria-label="Viewing read-only" />
											{:else if b.isRemote}
												<Cloud class="size-3.5 text-muted-foreground" aria-label="Remote branch" />
											{:else}
												<GitBranch
													class={cn(
														'size-3.5',
														b.current ? 'text-success' : 'text-muted-foreground'
													)}
												/>
											{/if}
											<span
												class={cn(
													'min-w-0 flex-1 truncate font-mono text-xs',
													isViewed && 'font-semibold'
												)}
											>
												{b.name}
											</span>
											<!-- Surface the disk truth: while drifted, mark which branch is
											     actually checked out so it's never hidden. -->
											{#if drifted && b.current}
												<span
													class="shrink-0 rounded bg-foreground/10 px-1 py-0.5 text-[10px] leading-none font-medium text-muted-foreground"
												>
													checked out
												</span>
											{/if}
											<!-- Checked out in another worktree: selecting it enters that
											     worktree. From inside a worktree the main checkout shows up
											     the same way — label it for what it is. -->
											{#if b.worktreePath && !b.current}
												<span
													class="shrink-0 rounded bg-foreground/10 px-1 py-0.5 text-[10px] leading-none font-medium text-muted-foreground"
													title={b.worktreePath}
												>
													{b.worktreePath === app.activeRepo?.path ? 'main checkout' : 'worktree'}
												</span>
											{/if}
											{#if relativeFor(b)}
												<span class="shrink-0 text-[10px] text-muted-foreground">
													{relativeFor(b)}
												</span>
											{/if}
										</Command.Item>
									{/if}
								{/each}
							</Command.Group>
						{/if}
					</Command.List>
				{:else}
					{#if hasUpstream}
						<!-- Fork repos can browse their own PRs or their upstream's. -->
						<div class="flex items-center gap-2 border-b border-border px-2 py-1.5">
							<GitFork class="size-3.5 shrink-0 text-muted-foreground" />
							<span
								class="min-w-0 flex-1 truncate font-mono text-xs"
								title={sourceLabel(app.prsSource)}
							>
								{sourceLabel(app.prsSource)}
							</span>
							<div class="flex shrink-0 items-center gap-0.5 rounded-md border border-input p-0.5">
								{#each [{ value: 'upstream', label: 'Upstream' }, { value: 'fork', label: 'Fork' }] as opt (opt.value)}
									<button
										type="button"
										onclick={() => actions.setPRSource(opt.value as PRSource)}
										title={sourceLabel(opt.value as PRSource)}
										class={cn(
											'rounded px-1.5 py-0.5 text-[11px] font-medium',
											app.prsSource === opt.value
												? 'bg-accent text-foreground'
												: 'text-muted-foreground hover:text-foreground'
										)}
									>
										{opt.label}
									</button>
								{/each}
							</div>
						</div>
					{/if}
					<Command.List class="max-h-[320px]">
						{#if app.loading.prs}
							<div
								class="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground"
							>
								<Loader2 class="size-3.5 animate-spin" />
								Loading pull requests…
							</div>
						{:else if app.prs.length === 0}
							<div class="px-3 py-6 text-center text-xs text-muted-foreground">
								No pull requests
							</div>
						{:else if prRows.length === 0}
							<div class="px-3 py-6 text-center text-xs text-muted-foreground">No matches</div>
						{:else}
							<Command.Group class="p-1">
								<!-- Rows render straight into the list (no virtualization) so
								     bits-ui Command can move selection through them and scroll the
								     highlighted row into view on arrow keys. The trailing sentinel
								     pages in more PRs once it scrolls into view. -->
								{#each prRows as row (row.kind === 'pr' ? `pr:${row.pr.number}` : 'loadMore')}
									{#if row.kind === 'loadMore'}
										<div
											use:loadMoreOnVisible
											class="flex items-center justify-center gap-2 py-3 text-[10px] text-muted-foreground"
										>
											<Loader2 class="size-3 animate-spin" />
											Loading more…
										</div>
									{:else}
										{@const pr = row.pr}
										{@const status = prStatus(pr)}
										{@const isViewed = app.viewPR?.number === pr.number}
										{@const Icon = isViewed ? Eye : status.icon}
										<!-- A Command.Item (not a bare button) so the filter input's
										     arrow keys move selection through the list, matching the
										     Branches tab. -->
										<Command.Item
											value={`pr-${pr.number}`}
											onSelect={() => openPR(pr)}
											oncontextmenu={(e) => showPRContextMenu(e, pr)}
											title={pr.title}
											class={cn(
												'gap-2.5 [content-visibility:auto] [contain-intrinsic-size:auto_48px]',
												isViewed && 'bg-accent/60'
											)}
										>
											<Icon
												class={cn('size-4 shrink-0', isViewed ? 'text-foreground' : status.class)}
												aria-label={isViewed ? 'Viewing read-only' : status.label}
											/>
											<div class="flex min-w-0 flex-1 flex-col">
												<span class="truncate text-xs font-medium">
													{pr.title}
												</span>
												<span class="truncate text-[10px] text-muted-foreground">
													#{pr.number} · {pr.author} · {prRelative(pr)}
												</span>
											</div>
										</Command.Item>
									{/if}
								{/each}
							</Command.Group>
						{/if}
					</Command.List>
				{/if}
			</Command.Root>
		</UnderlineTabs.Root>
	</Popover.Content>
</Popover.Root>
