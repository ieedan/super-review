<script lang="ts">
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import { actions, app } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import { VirtualList } from '$lib/virtual-list';
	import type { CommitInfo } from '@shared/types';

	// Virtualized list of the viewed branch/PR head's commits, shown in the sidebar
	// when the History tab is active and no commit is open. Selecting one opens its
	// diff (the commit against its first parent), which swaps this list for the
	// commit's file list — the same way selecting a session opens its frozen diff.
	const commits = $derived(app.commits);

	// Fixed row height — drives the virtualizer's geometry. Two lines (the subject
	// and the author/time/sha meta) plus padding.
	const ROW_HEIGHT = 54;

	// svelte-tiny-virtual-list needs an explicit pixel height and owns its own
	// scroll container, so measure the slot it fills (the sidebar content area).
	let viewportHeight = $state(0);

	// Re-read nowTick so relative timestamps tick with the app's shared interval.
	function relative(authoredAt: number): string {
		void app.nowTick;
		return formatRelative(new Date(authoredAt).toISOString());
	}

	function open(commit: CommitInfo): void {
		void actions.openCommit(commit);
	}
</script>

{#if commits.length === 0}
	<div class="px-3 py-8 text-center text-xs text-muted-foreground">No commits yet</div>
{:else}
	<!-- Fills the sidebar content height; the VirtualList scrolls internally. -->
	<div class="h-full" bind:clientHeight={viewportHeight}>
		{#if viewportHeight > 0}
			<VirtualList
				width="100%"
				height={viewportHeight}
				itemCount={commits.length}
				itemSize={ROW_HEIGHT}
				overscanCount={6}
			>
				{#snippet item({ index, style })}
					{@const commit = commits[index]}
					<div {style}>
						<div
							role="button"
							tabindex="0"
							class="group flex h-full cursor-pointer items-start gap-2.5 border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-accent"
							onclick={() => open(commit)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									open(commit);
								}
							}}
						>
							<div
								class="mt-0.5 grid size-6 flex-none place-items-center rounded-md border border-border bg-card text-muted-foreground"
							>
								<GitCommitHorizontal class="size-3.5" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="truncate text-xs font-medium">{commit.subject}</div>
								<div
									class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums"
								>
									<span class="max-w-[10rem] truncate">{commit.authorName}</span>
									<span>·</span>
									<span>{relative(commit.authoredAt)}</span>
									<span>·</span>
									<span class="font-mono">{commit.shortHash}</span>
								</div>
							</div>
						</div>
					</div>
				{/snippet}
			</VirtualList>
		{/if}
	</div>
{/if}
