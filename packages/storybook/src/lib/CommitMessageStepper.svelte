<script lang="ts">
	// Manual walkthrough: every state the flow passes through, one click apart, in
	// both directions. Steps are absolute snapshots (see buildFlowSteps), so
	// stepping back is just re-applying an earlier one.
	import { Button } from '@super-review/ui/components/ui/button';
	import CommitMessageFlowBox from './CommitMessageFlowBox.svelte';
	import { applyFlowStep, buildFlowSteps, type MockResponse } from './commit-message-flow';

	let { response }: { response: MockResponse } = $props();

	const steps = $derived(buildFlowSteps(response));
	let index = $state(0);

	let open = $state(false);
	let subject = $state('');
	let body = $state('');

	const step = $derived(steps[Math.min(index, steps.length - 1)]);

	// Re-applies on every index change, and again if the mocked response is
	// edited from the Controls panel while a step is on screen.
	$effect(() => {
		if (!step) return;
		applyFlowStep(step);
		subject = step.applied?.subject ?? '';
		body = step.applied?.body ?? '';
	});

	// The click that advances a step lands outside the popover, so the popover
	// dismisses itself on the way. Reading `open` here means that dismissal
	// re-runs this and puts it back: while a step says open, it stays open.
	$effect(() => {
		if (step && open !== step.popoverOpen) open = step.popoverOpen;
	});

	function go(delta: number): void {
		index = Math.min(steps.length - 1, Math.max(0, index + delta));
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'ArrowRight') go(1);
		else if (e.key === 'ArrowLeft') go(-1);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex w-[420px] flex-col gap-3">
	<CommitMessageFlowBox bind:open bind:subject bind:body />

	<div class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
		<div class="flex items-center gap-2">
			<Button variant="outline" size="sm" disabled={index === 0} onclick={() => go(-1)}>
				← Back
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={index === steps.length - 1}
				onclick={() => go(1)}
			>
				Next →
			</Button>
			<span class="ml-auto text-xs text-muted-foreground">
				{index + 1} / {steps.length}
			</span>
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-xs font-medium">{step?.label}</span>
			<p class="text-[11px] leading-snug text-muted-foreground">{step?.note}</p>
		</div>

		<!-- Jump straight to any state; handy when only one of them is being worked on. -->
		<div class="flex flex-wrap gap-1">
			{#each steps as s, i (s.label)}
				<button
					type="button"
					class="rounded-sm border border-border px-1.5 py-0.5 text-[10px] transition-colors {i ===
					index
						? 'bg-primary text-primary-foreground'
						: 'text-muted-foreground hover:bg-muted'}"
					onclick={() => (index = i)}
				>
					{i + 1}. {s.label}
				</button>
			{/each}
		</div>

		<p class="text-[10px] text-muted-foreground">← / → also step.</p>
	</div>
</div>
