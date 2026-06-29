<script lang="ts">
	// Local usage stats for the active repo as a small dashboard: a metric picker,
	// KPI cards for that metric (today / this month / all time / best day), and a
	// contribution-style heatmap of the last six months — the same layerchart
	// Calendar the commits tab uses. Every number is local; nothing is sent away.
	import FileText from '@lucide/svelte/icons/file-text';
	import Code from '@lucide/svelte/icons/code';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
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

	let selectedMetric = $state<StatMetric>('commitsAuthored');

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

	// The active repo's stats (falling back to the all-repos roll-up when no repo
	// is active, e.g. opened from a global surface).
	const source = $derived<RepoUsageStats>(app.usageStats ?? actions.aggregateStats());
	const daily = $derived<DailyCounts>(source.daily[selectedMetric] ?? {});

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

	const weeks = timeWeek.count(rangeStart, rangeEnd) + 1;

	let containerWidth = $state(0);
	// Size cells to fill the panel width (which matches the cards above it), so the
	// heatmap is as wide as its container rather than a fixed grid. Clamped so cells
	// stay tappable but never balloon on a wide settings pane.
	const cellSize = $derived(
		containerWidth > 0 ? Math.max(10, Math.min(16, Math.floor(containerWidth / weeks))) : 12
	);
	const calWidth = $derived(cellSize * weeks);
	const chartHeight = $derived(7 * cellSize);
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

<div class="w-full">
	<!-- Metric picker -->
	<div class="relative inline-block">
		<select
			bind:value={selectedMetric}
			aria-label="Metric"
			class="h-8 w-auto appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
		>
			{#each METRICS as m (m.key)}
				<option value={m.key}>{m.label}</option>
			{/each}
		</select>
		<ChevronDown
			class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
		/>
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
						<Calendar start={rangeStart} end={rangeEnd} {cellSize}>
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
