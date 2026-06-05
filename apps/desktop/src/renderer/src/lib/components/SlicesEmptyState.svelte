<script lang="ts">
	import { app } from '$lib/store.svelte';
	import InstallSkillButton from './InstallSkillButton.svelte';

	// Main-panel placeholder on the Slices tab when no slice is open.
	const hasSlices = $derived(app.slices.length > 0);
</script>

<div class="grid h-full w-full place-items-center p-6">
	<div class="max-w-sm text-center">
		{#if hasSlices}
			<h2 class="text-lg font-semibold">Select a slice</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				Choose a slice from the sidebar to review its changes.
			</p>
		{:else}
			<h2 class="text-lg font-semibold">No slices yet</h2>
			{#if app.skillInstalled === false}
				<p class="mt-2 text-sm text-muted-foreground">
					Get started with slices by installing the skill. It lets coding agents document their
					changes here for review.
				</p>
				<div class="mt-5 flex justify-center">
					<InstallSkillButton />
				</div>
			{:else}
				<p class="mt-2 text-sm text-muted-foreground">
					Slices show up here once a coding agent documents its changes.
				</p>
			{/if}
		{/if}
	</div>
</div>
