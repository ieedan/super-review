<script lang="ts">
	// Lists the changesets on this branch that look unnecessary — each bumps at
	// least one package with no actual changes — and lets the user remove the ones
	// they don't want to commit.
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import { actions, app } from '$lib/store.svelte';
	import FileIcon from './FileIcon.svelte';

	const open = $derived(app.changesetReviewOpen);
	const changedSet = $derived(new Set(app.changesetStatus?.changedPackages ?? []));

	// Changesets that bump at least one package with no changes on this branch.
	const suspicious = $derived(
		(app.changesetStatus?.branchChangesets ?? []).filter((cs) =>
			cs.packages.some((p) => !changedSet.has(p))
		)
	);

	// Track in-flight removals so the button disables while the file is deleted.
	let removing = $state<Record<string, boolean>>({});

	function onOpenChange(v: boolean): void {
		if (!v) actions.closeChangesetReview();
	}

	// Once every suspicious changeset has been removed there's nothing left to
	// review, so close the dialog automatically. (It can only be opened while at
	// least one exists, so this never fires on open.)
	$effect(() => {
		if (app.changesetReviewOpen && suspicious.length === 0) {
			actions.closeChangesetReview();
		}
	});

	async function remove(path: string): Promise<void> {
		removing[path] = true;
		try {
			await actions.removeChangeset(path);
		} finally {
			removing[path] = false;
		}
	}

	function fileName(path: string): string {
		return path.split('/').pop() ?? path;
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="flex max-h-[85vh] flex-col gap-4 sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				<ChangesetLogo class="h-4 w-auto" />
				Review changesets
			</Dialog.Title>
			<Dialog.Description class="text-xs">
				These changesets bump a package that has no changes on this branch, so they may not be
				needed. Remove any you don't want to commit.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
			{#each suspicious as cs (cs.path)}
				<div class="overflow-hidden rounded-md border border-border">
					<header class="flex h-9 items-center gap-2 border-b border-border bg-card/95 px-3">
						<FileIcon path={cs.path} class="size-3.5 shrink-0" />
						<span class="min-w-0 flex-1 truncate font-mono text-xs" title={cs.path}>
							{fileName(cs.path)}
						</span>
						<Button
							type="button"
							size="xs"
							variant="ghost"
							class="h-6 shrink-0 gap-1 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
							disabled={removing[cs.path]}
							onclick={() => remove(cs.path)}
						>
							<Trash2 class="size-3.5" />
							Remove
						</Button>
					</header>
					<div class="flex flex-wrap gap-1.5 p-2">
						{#each cs.packages as pkg (pkg)}
							{@const changed = changedSet.has(pkg)}
							<span
								class="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] {changed
									? 'border-border text-muted-foreground'
									: 'border-warning/40 bg-warning/10 text-warning'}"
							>
								<span class="font-mono">{pkg}</span>
								{#if !changed}<span class="opacity-80">· no changes</span>{/if}
							</span>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<Dialog.Footer>
			<Button type="button" size="sm" onclick={() => actions.closeChangesetReview()}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
