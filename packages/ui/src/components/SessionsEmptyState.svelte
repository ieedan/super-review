<script lang="ts">
	import { app } from '@super-review/ui/store.svelte';
	import ConfigureAiButton from './ConfigureAiButton.svelte';

	// Main-panel placeholder on the Sessions tab when no session is open.
	const hasSessions = $derived(app.sessions.length > 0);
</script>

<div class="grid h-full w-full place-items-center p-6">
	<div class="max-w-sm text-center">
		{#if hasSessions}
			<h2 class="text-lg font-semibold">Select a session</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				Choose a session from the sidebar to review its changes.
			</p>
		{:else}
			<h2 class="text-lg font-semibold">No sessions yet</h2>
			{#if app.aiConfigStatus?.anyInstalled === false}
				<p class="mt-2 text-sm text-muted-foreground">
					Get started by configuring AI files for your coding agent. They let it document its
					changes here for review.
				</p>
				<div class="mt-5 flex justify-center">
					<ConfigureAiButton />
				</div>
			{:else}
				<p class="mt-2 text-sm text-muted-foreground">
					Sessions show up here once a coding agent documents its changes.
				</p>
			{/if}
		{/if}
	</div>
</div>
