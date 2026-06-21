<script lang="ts">
	import { app } from '$lib/store.svelte';

	// Main-panel placeholder on the History tab when no commit is open.
	const hasCommits = $derived(app.commits.length > 0);
</script>

<div class="grid h-full w-full place-items-center p-6">
	<div class="max-w-sm text-center">
		{#if hasCommits}
			<h2 class="text-lg font-semibold">Select a commit</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				Choose a commit from the sidebar to review the files it changed.
			</p>
		{:else}
			<h2 class="text-lg font-semibold">No commits yet</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				Commits on this branch show up here once there's history to look back through.
			</p>
		{/if}
	</div>
</div>
