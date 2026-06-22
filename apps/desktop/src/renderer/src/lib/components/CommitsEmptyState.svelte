<script lang="ts">
	import { app } from '$lib/store.svelte';
	import { Chart, Svg, Calendar } from 'layerchart/svg';

	const hasCommits = $derived(app.commits.length > 0);

	const now = new Date();
	const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	const rangeStart = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());

	type DayData = { date: Date; count: number };

	const calendarData = $derived.by((): DayData[] => {
		const map = new Map<number, DayData>();
		for (const commit of app.commits) {
			const d = new Date(commit.authoredAt);
			const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
			const key = day.valueOf();
			const entry = map.get(key);
			if (entry) {
				entry.count++;
			} else {
				map.set(key, { date: day, count: 1 });
			}
		}
		return [...map.values()];
	});

	function cellFill(count: number): string {
		if (count === 0) return 'var(--color-muted)';
		if (count === 1) return 'color-mix(in oklab, var(--color-primary) 30%, var(--color-muted))';
		if (count <= 3) return 'color-mix(in oklab, var(--color-primary) 60%, var(--color-muted))';
		return 'var(--color-primary)';
	}
</script>

<div class="grid h-full w-full place-items-center p-6">
	{#if hasCommits}
		<div class="flex w-full flex-col items-center gap-4">
			<div class="text-center">
				<h2 class="text-lg font-semibold">Select a commit</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					Choose a commit from the sidebar to review the files it changed.
				</p>
			</div>
			<div class="h-40 w-full">
				<Chart data={calendarData} x={(d: DayData) => d.date} padding={{ top: 20 }}>
					<Svg>
						<Calendar start={rangeStart} end={rangeEnd} monthLabel>
							{#snippet children({ cells, cellSize })}
								{#each cells as cell}
									<rect
										x={cell.x + 1}
										y={cell.y + 1}
										width={Math.max(0, cellSize[0] - 2)}
										height={Math.max(0, cellSize[1] - 2)}
										rx="2"
										style="fill: {cellFill(cell.data?.count ?? 0)}"
									/>
								{/each}
							{/snippet}
						</Calendar>
					</Svg>
				</Chart>
			</div>
		</div>
	{:else}
		<div class="max-w-sm text-center">
			<h2 class="text-lg font-semibold">No commits yet</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				Commits on this branch show up here once there's history to look back through.
			</p>
		</div>
	{/if}
</div>
