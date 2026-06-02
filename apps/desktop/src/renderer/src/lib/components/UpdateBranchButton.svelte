<script lang="ts">
	import { GitMerge, Loader2 } from 'lucide-svelte';
	import { Button } from './ui/button';
	import { actions, app } from '$lib/store.svelte';
	import { cn } from '$lib/utils';

	const status = $derived(app.pushStatus);
	// How many commits the default branch is ahead of this one. >0 means the
	// branch is out of date and "Update from <default>" has something to merge.
	const behind = $derived(status?.behindDefault ?? 0);
	const defaultBranch = $derived(app.activeRepo?.defaultBranch ?? 'main');

	// The update flow runs through the shared push state with intent "pull".
	// While stage is 'conflicts' the merge is paused on the conflict dialog —
	// the flow isn't actively running, so don't show the spinner.
	const updating = $derived(
		app.push.inProgress && app.push.intent === 'pull' && app.push.stage !== 'conflicts'
	);

	const title = $derived(
		`Update from ${defaultBranch} (${behind} commit${behind === 1 ? '' : 's'} behind)`
	);

	function click(): void {
		void actions.updateFromDefault();
	}
</script>

{#if app.activeRepo && behind > 0}
	<Button variant="outline" size="sm" disabled={app.push.inProgress} onclick={click} {title}>
		{#if updating}
			<Loader2 class={cn('size-3.5 animate-spin')} />
			<span class="text-xs">Updating…</span>
		{:else}
			<GitMerge class="size-3.5" />
			<span class="text-xs">Update branch</span>
		{/if}
	</Button>
{/if}
