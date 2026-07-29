<script lang="ts">
	// Runs the changeset-generation flow for a story: the real notice, the real
	// store action, and a mocked CLI behind window.api. Click the sparkle to start
	// a run, watch the row shimmer, and see the prompt clear once the changeset is
	// "written" — then Replay to put the branch back to needing one.
	import CommitNotices from '@super-review/ui/components/CommitNotices.svelte';
	import { Button } from '@super-review/ui/components/ui/button';
	import { app, actions } from '@super-review/ui/store.svelte';
	import { resetChangesetFlow, setChangesetRunMs } from './changeset-flow';

	let { runMs = 3000 }: { runMs?: number } = $props();

	$effect(() => setChangesetRunMs(runMs));

	const written = $derived(
		!app.changesetGenerating && (app.changesetStatus?.branchChangesets.length ?? 0) > 0
	);
</script>

<div class="flex w-[340px] flex-col gap-3">
	<!-- The notices stack positions its cards absolutely inside a box it sizes
	     itself, so reserve a row's worth of space rather than letting the story's
	     controls ride up under it. -->
	<div class="min-h-[68px]">
		<CommitNotices />
	</div>

	<div class="flex items-center gap-2 px-2">
		<Button size="xs" variant="outline" onclick={() => resetChangesetFlow()}>Replay</Button>
		{#if app.changesetGenerating}
			<Button size="xs" variant="ghost" onclick={() => void actions.cancelChangesetGeneration()}>
				Cancel
			</Button>
		{/if}
		<span class="text-[11px] text-muted-foreground">
			{#if app.changesetGenerating}
				Writing…
			{:else if written}
				Wrote {app.changesetStatus?.branchChangesets[0]?.path}
			{:else}
				Click the sparkle to generate
			{/if}
		</span>
	</div>
</div>
