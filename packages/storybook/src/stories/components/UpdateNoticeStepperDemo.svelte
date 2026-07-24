<script lang="ts">
	// Drives UpdateNotice through the update lifecycle one click at a time, so the
	// download -> ready handoff can be judged as a sequence instead of as separate
	// static stories. Five download stages, then the installed/ready card.
	import UpdateNotice from '@super-review/ui/components/UpdateNotice.svelte';
	import { Button } from '@super-review/ui/components/ui/button';
	import type { UpdateStatus } from '@super-review/core/types';

	let {
		version = '1.2.0',
		/** Total download size the stages are computed against, in bytes. */
		total = 84 * 1024 * 1024
	}: { version?: string; total?: number } = $props();

	// Five download stages, then done. Percentages are uneven on purpose: a real
	// download doesn't arrive in tidy quarters, and it's where label/number widths
	// actually shift.
	const PERCENTS = [0, 18, 47, 76, 100];

	const stages: UpdateStatus[] = [
		...PERCENTS.map(
			(percent): UpdateStatus => ({
				state: 'downloading',
				version,
				percent,
				transferred: Math.round((percent / 100) * total),
				total,
				bytesPerSecond: 6 * 1024 * 1024
			})
		),
		{ state: 'downloaded', version }
	];

	let step = $state(0);
	const status = $derived(stages[step]);
	const done = $derived(step === stages.length - 1);
</script>

<div class="flex w-[320px] flex-col gap-3">
	<UpdateNotice
		{status}
		onRestart={() => console.log('[UpdateNotice] restart clicked')}
		onDismiss={() => console.log('[UpdateNotice] dismiss clicked')}
	/>

	<div class="flex items-center gap-2">
		<Button type="button" size="sm" variant="outline" onclick={() => (step = done ? 0 : step + 1)}>
			{done ? 'Start over' : 'Next stage'}
		</Button>
		<span class="text-xs tabular-nums text-muted-foreground">
			{done ? 'Ready to install' : `Stage ${step + 1} of ${PERCENTS.length}`}
		</span>
	</div>
</div>
