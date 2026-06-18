<script lang="ts">
	// The compact "Add a changeset?" bar shown above the commit box when the
	// current branch changed a releasable package that no changeset covers yet.
	// "Add" opens the create-changeset dialog; the × dismisses it for this branch.
	import X from '@lucide/svelte/icons/x';
	import { Button } from './ui/button';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import { actions, app, changesetPromptKey } from '$lib/store.svelte';

	const dismissed = $derived(app.changesetPromptDismissedFor === changesetPromptKey());
	const show = $derived((app.changesetStatus?.needsChangeset ?? false) && !dismissed);
</script>

{#if show}
	<div
		class="mx-2 mt-2 mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 shadow-sm"
	>
		<ChangesetLogo class="h-4 w-auto shrink-0" />
		<span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
			Add a changeset?
		</span>
		<Button
			type="button"
			size="xs"
			variant="outline"
			class="h-6 shrink-0 text-[11px]"
			onclick={() => actions.openChangesetDialog()}
		>
			Add
		</Button>
		<Button
			type="button"
			size="icon-xs"
			variant="ghost"
			class="size-6 shrink-0 text-muted-foreground"
			title="Dismiss for this branch"
			onclick={() => actions.dismissChangesetPrompt()}
		>
			<X class="size-3.5" />
			<span class="sr-only">Dismiss</span>
		</Button>
	</div>
{/if}
