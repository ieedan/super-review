<script lang="ts">
	// Local usage stats as a small dashboard: a tab per metric, KPI cards for that
	// metric (today / this month / all time / best day), and a contribution-style
	// heatmap of the last six months — the same layerchart Calendar the commits
	// tab uses. A scope toggle switches between the active repo and an all-repos
	// roll-up. Every number is local; nothing is sent anywhere.
	import FileText from '@lucide/svelte/icons/file-text';
	import Code from '@lucide/svelte/icons/code';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import type { LucideIcon } from '@lucide/svelte';
	import { Chart, Svg, Calendar } from 'layerchart/svg';
	import { timeWeek } from 'd3-time';
	import { onMount } from 'svelte';
	import {
		dayKey,
		metricTotal,
		type DailyCounts,
		type RepoUsageStats,
		type StatMetric
	} from '@super-review/core/usage-stats';
	import { actions, app } from '@super-review/ui/store.svelte';
	import * as Tabs from './ui/tabs';
	import { cn } from '@super-review/ui/utils';

	let selectedMetric = $state<StatMetric>('filesReviewed');
	let scope = $state<'repo' | 'all'>('repo');

	onMount(() => {
		void actions.loadStats();
	});

	const METRICS: { key: StatMetric; label: string; short: string; icon: LucideIcon }[] = [
		{ key: 'filesReviewed', label: 'Files reviewed', short: 'Files', icon: FileText },
		{ key: 'locReviewed', label: 'Lines reviewed', short: 'Lines', icon: Code },
		{ key: 'prsMerged', label: 'PRs merged', short: 'PRs', icon: GitPullRequest },
		{ key: 'branchesCreated', label: 'Branches created', short: 'Branches', icon: GitBranch },
		{
			key: 'commitsAuthored',
			label: 'Commits authored',
			short: 'Commits',
			icon: GitCommitHorizontal
		},
		{ key: 'sessionsReviewed', label: 'Sessions reviewed', short: 'Sessions', icon: BookOpen },
		{ key: 'commentsWritten', label: 'Comments written', short: 'Comments', icon: MessageSquare }
	];

	const meta = $derived(METRICS.find((m) => m.key === selectedMetric)!);
	const MetaIcon = $derived(meta.icon);

	// The stats backing the view: a single repo, or the summed all-repos roll-up.
	const source = $derived<RepoUsageStats>(
		scope === 'all' ? actions.aggregateStats() : (app.usageStats ?? actions.aggregateStats())
	);
	const daily = $derived<DailyCounts>(source.daily[selectedMetric] ?? {});

	// Offer the all-repos roll-up only when there's more than one repo to roll up.
	const showScope = $derived(app.repos.length > 1);

	// --- KPIs -----------------------------------------------------------------
	const now = new Date();
	const todayKey = dayKey(now);
	const monthPrefix = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;

	const today = $derived(daily[todayKey] ?? 0);
	const thisMonth = $derived(
		Object.entries(daily).reduce((sum, [k, v]) => (k.startsWith(monthPrefix) ? sum + v : sum), 0)
	);
	const allTime = $derived(metricTotal(daily));
	const bestDay = $derived(Object.values(daily).reduce((max, v) => Math.max(max, v), 0));

	const KPIS = $derived([
		{ label: 'Today', value: today },
		{ label: 'This month', value: thisMonth },
		{ label: 'All time', value: allTime },
		{ label: 'Best day', value: bestDay }
	]);

	const nf = new Intl.NumberFormat();
	const fmt = (n: number) => nf.format(n);

	// --- Heatmap (last 6 months) ----------------------------------------------
	const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	const rangeStart = new Date(now.getFullYear(), now.getMonth() - 5, now.getDate());

	const CELL_SIZE = 11;
	const calWidth = (timeWeek.count(rangeStart, rangeEnd) + 1) * CELL_SIZE;
	const chartHeight = 7 * CELL_SIZE;

	let containerWidth = $state(0);
	const centerOffset = $derived(Math.max(0, (containerWidth - calWidth) / 2));

	type DayData = { date: Date; count: number };

	function parseDayKey(key: string): Date {
		const [y, m, d] = key.split('-').map(Number);
		return new Date(y, m - 1, d);
	}

	const calendarData = $derived<DayData[]>(
		Object.entries(daily).map(([key, count]) => ({ date: parseDayKey(key), count }))
	);

	// Tooltip text for one day: the date plus its count, shown via a native SVG
	// <title> so we don't mount a popover per cell (there are ~180 of them).
	function cellTitle(date: Date, count: number): string {
		const when = date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
		return `${when}: ${fmt(count)} ${meta.label.toLowerCase()}`;
	}

	// Shade relative to the metric's busiest day so both small counts (PRs) and
	// large ones (lines) read well, rather than fixed thresholds tuned for commits.
	function cellFill(count: number): string {
		if (count <= 0 || bestDay <= 0) return 'var(--color-muted)';
		const r = count / bestDay;
		if (r <= 0.25) return 'color-mix(in oklab, var(--color-primary) 25%, var(--color-muted))';
		if (r <= 0.5) return 'color-mix(in oklab, var(--color-primary) 45%, var(--color-muted))';
		if (r <= 0.75) return 'color-mix(in oklab, var(--color-primary) 70%, var(--color-muted))';
		return 'var(--color-primary)';
	}
</script>

<div class="mx-auto w-full max-w-xl">
	<!-- Metric tabs + scope toggle -->
	<div class="flex items-center justify-between gap-2">
		<Tabs.Root value={selectedMetric} onValueChange={(v) => (selectedMetric = v as StatMetric)}>
			<Tabs.List
				class="no-scrollbar h-auto w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-none border-0 bg-transparent p-0"
			>
				{#each METRICS as m (m.key)}
					{@const Icon = m.icon}
					<Tabs.Trigger
						value={m.key}
						class="h-7 flex-none gap-1.5 rounded-md border-0 px-2.5 py-1.5 text-xs shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none dark:data-active:border-0 dark:data-active:bg-muted"
					>
						<Icon class="size-3.5" />
						{m.short}
					</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>

		{#if showScope}
			<div class="flex flex-none items-center gap-0.5 rounded-md border border-border p-0.5">
				<button
					type="button"
					class={cn(
						'rounded px-2 py-0.5 text-xs',
						scope === 'repo'
							? 'bg-muted text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => (scope = 'repo')}
				>
					This repo
				</button>
				<button
					type="button"
					class={cn(
						'rounded px-2 py-0.5 text-xs',
						scope === 'all'
							? 'bg-muted text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => (scope = 'all')}
				>
					All repos
				</button>
			</div>
		{/if}
	</div>

	<!-- KPI cards -->
	<div class="mt-3 grid grid-cols-4 gap-1.5">
		{#each KPIS as kpi (kpi.label)}
			<div class="rounded-md border border-border bg-card/30 px-2.5 py-1.5">
				<div class="text-lg leading-tight font-semibold tabular-nums">{fmt(kpi.value)}</div>
				<div class="text-[11px] text-muted-foreground">{kpi.label}</div>
			</div>
		{/each}
	</div>

	<!-- Heatmap -->
	<div class="mt-3">
		<div class="flex items-center justify-between">
			<h3 class="flex items-center gap-1.5 text-xs font-medium">
				<MetaIcon class="size-3.5 text-muted-foreground" />
				{meta.label}
			</h3>
			<span class="text-[11px] text-muted-foreground">last 6 months</span>
		</div>
		<div
			class="mt-1.5 w-full overflow-hidden"
			style="height: {chartHeight}px"
			bind:clientWidth={containerWidth}
		>
			<Chart data={calendarData} x={(d: DayData) => d.date}>
				<Svg>
					<g transform="translate({centerOffset}, 0)">
						<Calendar start={rangeStart} end={rangeEnd} cellSize={CELL_SIZE}>
							{#snippet children({ cells, cellSize })}
								{#each cells as cell (cell.x + '-' + cell.y)}
									<rect
										x={cell.x + 1}
										y={cell.y + 1}
										width={Math.max(0, cellSize[0] - 2)}
										height={Math.max(0, cellSize[1] - 2)}
										rx="2"
										style="fill: {cellFill(cell.data?.count ?? 0)}"
									>
										<title>{cellTitle(cell.data.date, cell.data?.count ?? 0)}</title>
									</rect>
								{/each}
							{/snippet}
						</Calendar>
					</g>
				</Svg>
			</Chart>
		</div>
		{#if allTime === 0}
			<p class="mt-1 text-center text-[11px] text-muted-foreground">
				No {meta.label.toLowerCase()} recorded yet. Your activity will show up here as you review.
			</p>
		{/if}
	</div>
</div>
