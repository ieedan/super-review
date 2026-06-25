<script lang="ts">
	// Toolbar button to open the create-changeset dialog. Always available (when the
	// repo uses changesets) so you can add another changeset even after the
	// "Add a changeset?" prompt above the commit box is gone.
	import { Button } from './ui/button';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import { actions, app } from '@super-review/ui/store.svelte';

	const installed = $derived(app.changesetStatus?.installed ?? false);
</script>

{#if installed}
	<Button
		variant="ghost"
		size="icon-sm"
		onclick={() => actions.openChangesetDialog()}
		title="Add a changeset"
	>
		<ChangesetLogo class="size-4" />
	</Button>
{/if}
