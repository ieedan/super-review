<script lang="ts">
	// Local usage stats, shown two ways. The full panel (Settings ▸ Stats) leads
	// with an "all repos" roll-up of headline numbers, then a per-repo breakdown
	// table. The compact variant (the unstaged empty state) shows a single muted
	// row for the active repo. All numbers are local; nothing is sent anywhere.
	import FileText from '@lucide/svelte/icons/file-text';
	import Code from '@lucide/svelte/icons/code';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import type { LucideIcon } from '@lucide/svelte';
	import type { RepoUsageStats } from '@super-review/core/types';
	import { onMount } from 'svelte';
	import { actions, app } from '@super-review/ui/store.svelte';
	import * as Table from './ui/table';

	let { compact = false }: { compact?: boolean } = $props();

	// Load (or refresh) stats whenever the panel mounts; the numbers only move on
	// the user's own actions, so a fetch-on-open is enough.
	onMount(() => {
		void actions.loadStats();
	});

	// The headline metrics in display order, shared by both variants.
	const METRICS: { key: keyof RepoUsageStats; label: string; icon: LucideIcon }[] = [
		{ key: 'filesReviewed', label: 'Files reviewed', icon: FileText },
		{ key: 'locReviewed', label: 'Lines reviewed', icon: Code },
		{ key: 'prsMerged', label: 'PRs merged', icon: GitPullRequest },
		{ key: 'branchesCreated', label: 'Branches created', icon: GitBranch },
		{ key: 'commitsAuthored', label: 'Commits authored', icon: GitCommitHorizontal },
		{ key: 'sessionsReviewed', label: 'Sessions reviewed', icon: BookOpen },
		{ key: 'commentsWritten', label: 'Comments written', icon: MessageSquare }
	];

	// Aggregate across all repos for the full panel's headline; the compact strip
	// shows just the active repo.
	const aggregate = $derived(actions.aggregateStats());
	const active = $derived(app.usageStats);

	// Repos that have any recorded activity, newest-activity-first, for the table.
	const breakdown = $derived.by(() => {
		const byRepo = app.usageStatsByRepo ?? {};
		return app.repos
			.map((r) => ({ repo: r, stats: byRepo[r.id] }))
			.filter((row): row is { repo: (typeof app.repos)[number]; stats: RepoUsageStats } =>
				Boolean(row.stats && row.stats.firstUsedAt !== null)
			)
			.sort((a, b) => (b.stats.firstUsedAt ?? 0) - (a.stats.firstUsedAt ?? 0));
	});

	const nf = new Intl.NumberFormat();
	function fmt(n: number): string {
		return nf.format(n);
	}

	// "Active since" as a plain date, or a placeholder when nothing is recorded yet.
	function activeSince(at: number | null): string {
		if (at === null) return 'not yet';
		return new Date(at).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

{#if compact}
	{#if active && active.firstUsedAt !== null}
		<div class="border-t border-border pt-4">
			<div
				class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
			>
				{#each METRICS as m (m.key)}
					{@const Icon = m.icon}
					<span class="flex items-center gap-1">
						<Icon class="size-3.5 opacity-60" />
						<span class="font-medium text-foreground">{fmt(active[m.key] as number)}</span>
						{m.label.toLowerCase()}
					</span>
				{/each}
			</div>
			<p class="mt-2 text-center text-[11px] text-muted-foreground/70">
				Your local review stats for this repository.
			</p>
		</div>
	{/if}
{:else}
	<div class="space-y-6">
		<div>
			<h2 class="text-sm font-semibold">All repositories</h2>
			<p class="mt-0.5 text-xs text-muted-foreground">
				Everything you have reviewed locally, across every repository. None of this leaves your
				machine.
			</p>
			<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
				{#each METRICS as m (m.key)}
					{@const Icon = m.icon}
					<div class="rounded-lg border border-border bg-card/30 p-3">
						<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
							<Icon class="size-3.5" />
							{m.label}
						</div>
						<div class="mt-1 text-xl font-semibold tabular-nums">
							{fmt(aggregate[m.key] as number)}
						</div>
					</div>
				{/each}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">
				Active since {activeSince(aggregate.firstUsedAt)}
			</p>
		</div>

		{#if breakdown.length > 0}
			<div>
				<h2 class="text-sm font-semibold">By repository</h2>
				<div class="mt-3 overflow-hidden rounded-lg border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Repository</Table.Head>
								<Table.Head class="text-right">Files</Table.Head>
								<Table.Head class="text-right">Lines</Table.Head>
								<Table.Head class="text-right">PRs</Table.Head>
								<Table.Head class="text-right">Branches</Table.Head>
								<Table.Head class="text-right">Commits</Table.Head>
								<Table.Head class="text-right">Sessions</Table.Head>
								<Table.Head class="text-right">Comments</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each breakdown as row (row.repo.id)}
								<Table.Row>
									<Table.Cell class="font-medium">{row.repo.name}</Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{fmt(row.stats.filesReviewed)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{fmt(row.stats.locReviewed)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums">{fmt(row.stats.prsMerged)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{fmt(row.stats.branchesCreated)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{fmt(row.stats.commitsAuthored)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{fmt(row.stats.sessionsReviewed)}</Table.Cell
									>
									<Table.Cell class="text-right tabular-nums"
										>{fmt(row.stats.commentsWritten)}</Table.Cell
									>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</div>
		{/if}
	</div>
{/if}
