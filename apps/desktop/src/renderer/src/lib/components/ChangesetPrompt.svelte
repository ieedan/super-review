<script lang="ts">
	// Compact bars shown above the commit box for the changeset state of the branch:
	//  - "Add a changeset?" — a releasable package changed but no changeset covers it
	//    yet ("Add" opens the dialog; × dismisses it for this branch).
	//  - "Some changesets may be unnecessary" (warning) — a changeset references a
	//    package that has no actual changes on this branch, so it probably shouldn't
	//    be committed.
	import X from '@lucide/svelte/icons/x';
	import { Button } from './ui/button';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import { actions, app } from '$lib/store.svelte';

	const showAdd = $derived(
		(app.changesetStatus?.needsChangeset ?? false) && !app.changesetPromptDismissed
	);

	// Packages with a changeset (introduced on this branch) but no actual changes —
	// the changeset bumping them is likely unnecessary.
	const unnecessary = $derived.by(() => {
		const s = app.changesetStatus;
		if (!s) return [];
		const changed = new Set(s.changedPackages);
		return s.coveredPackages.filter((p) => !changed.has(p));
	});
	const showWarning = $derived(unnecessary.length > 0 && !app.changesetWarningDismissed);
</script>

{#if showAdd || showWarning}
	<div class="mx-2 mt-2 mb-2 flex flex-col gap-2">
		{#if showWarning}
			<div
				class="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 shadow-sm"
				title={`No changes detected for ${unnecessary.join(', ')} — their changeset may be unnecessary.`}
			>
				<ChangesetLogo class="h-4 w-auto shrink-0" />
				<span class="min-w-0 flex-1 truncate text-[11px] text-warning">
					Some changesets may be unnecessary
				</span>
				<Button
					type="button"
					size="xs"
					variant="outline"
					class="h-6 shrink-0 border-warning/40 text-[11px] hover:bg-warning/10"
					onclick={() => actions.openChangesetReview()}
				>
					View
				</Button>
				<Button
					type="button"
					size="icon-xs"
					variant="ghost"
					class="size-6 shrink-0 text-muted-foreground"
					title="Dismiss for this branch"
					onclick={() => actions.dismissChangesetWarning()}
				>
					<X class="size-3.5" />
					<span class="sr-only">Dismiss</span>
				</Button>
			</div>
		{/if}

		{#if showAdd}
			<div
				class="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 shadow-sm"
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
	</div>
{/if}
