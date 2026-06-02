<script lang="ts">
	// "Clean Up Local Branches" — lists every local branch no longer present on a
	// remote (never pushed, or its upstream was deleted and pruned after a PR
	// merged) and lets the user pick which to delete. Branches with no parked
	// stash default to selected; branches that still hold a stash default to kept,
	// so we don't quietly delete work the user tucked away. Deleting a branch
	// never drops its stashes — those stay recoverable via `git stash list`.
	import { Archive, GitBranch, Loader2, Trash2 } from 'lucide-svelte';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { Checkbox } from './ui/checkbox';
	import { actions, app } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import type { LocalOnlyBranch } from '@shared/types';

	// null while the candidates are still loading; [] once loaded with none found.
	let branches = $state<LocalOnlyBranch[] | null>(null);
	let selected = $state<Record<string, boolean>>({});
	let busy = $state(false);

	const selectedNames = $derived(
		(branches ?? []).filter((b) => selected[b.name]).map((b) => b.name)
	);
	const allSelected = $derived(
		!!branches && branches.length > 0 && selectedNames.length === branches.length
	);
	const someSelected = $derived(selectedNames.length > 0 && !allSelected);

	$effect(() => {
		if (!app.cleanupBranchesDialogOpen) {
			branches = null;
			selected = {};
			busy = false;
			return;
		}
		const repo = app.activeRepo;
		if (!repo) return;
		const repoId = repo.id;
		void window.api.git.listLocalOnlyBranches(repoId).then((found) => {
			// Bail if the user closed the dialog or switched repos while we loaded.
			if (!app.cleanupBranchesDialogOpen || app.activeRepo?.id !== repoId) return;
			branches = found;
			// Default: select branches without a stash; leave stashed ones unchecked.
			const next: Record<string, boolean> = {};
			for (const b of found) next[b.name] = b.stashCount === 0;
			selected = next;
		});
	});

	function toggleAll(checked: boolean): void {
		const next: Record<string, boolean> = {};
		for (const b of branches ?? []) next[b.name] = checked;
		selected = next;
	}

	async function confirm(e?: Event): Promise<void> {
		e?.preventDefault();
		if (busy || selectedNames.length === 0) return;
		busy = true;
		try {
			const ok = await actions.cleanupLocalBranches(selectedNames);
			if (ok) actions.closeCleanupBranchesDialog();
		} finally {
			busy = false;
		}
	}

	function reason(b: LocalOnlyBranch): string {
		return b.goneUpstream ? `${b.goneUpstream} was deleted` : 'never pushed';
	}
</script>

<Dialog.Root
	open={app.cleanupBranchesDialogOpen}
	onOpenChange={(v) =>
		v ? actions.openCleanupBranchesDialog() : actions.closeCleanupBranchesDialog()}
>
	<Dialog.Content class="overflow-hidden sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				<GitBranch class="size-4" />
				Clean Up Local Branches
			</Dialog.Title>
			<Dialog.Description>
				These branches aren't on any remote. Pick the ones to delete — branches with stashed changes
				are left unchecked so you don't lose parked work.
			</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-3" onsubmit={confirm}>
			{#if branches === null}
				<div class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
					<Loader2 class="size-4 animate-spin" />
					Scanning branches…
				</div>
			{:else if branches.length === 0}
				<div class="flex flex-col items-center gap-1 py-10 text-center">
					<span class="text-sm font-medium">Nothing to clean up</span>
					<span class="text-xs text-muted-foreground">
						Every local branch is still on a remote.
					</span>
				</div>
			{:else}
				<!-- Select-all header sits flush above the list so they read as one block. -->
				<div class="grid gap-1">
					<label
						class="flex cursor-pointer items-center gap-2.5 border-b border-border pb-1.5 text-xs font-medium text-muted-foreground"
					>
						<Checkbox
							checked={allSelected}
							indeterminate={someSelected}
							onCheckedChange={(v) => toggleAll(v === true)}
							disabled={busy}
						/>
						{selectedNames.length} of {branches.length} selected
					</label>

					<div class="-mr-1 grid max-h-72 gap-1 overflow-y-auto pr-1">
						{#each branches as b (b.name)}
							<label
								for={`cleanup-${b.name}`}
								class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60 {selected[
									b.name
								]
									? 'bg-primary/5'
									: ''}"
							>
								<Checkbox
									id={`cleanup-${b.name}`}
									bind:checked={selected[b.name]}
									disabled={busy}
								/>
								<div class="flex min-w-0 flex-1 flex-col gap-0.5 text-left leading-snug">
									<span class="truncate font-mono text-sm">{b.name}</span>
									<span class="truncate text-xs text-muted-foreground">
										{reason(b)}{#if b.lastCommitAt}
											· updated {formatRelative(new Date(b.lastCommitAt).toISOString())}{/if}
									</span>
								</div>
								{#if b.stashCount > 0}
									<span
										class="flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
										title="Deleting the branch keeps its stash — recover it with `git stash list`."
									>
										<Archive class="size-3" />
										{b.stashCount} stash{b.stashCount === 1 ? '' : 'es'}
									</span>
								{/if}
							</label>
						{/each}
					</div>
				</div>
			{/if}

			<Dialog.Footer>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy}
					onclick={() => actions.closeCleanupBranchesDialog()}
				>
					Cancel
				</Button>
				<Button
					type="submit"
					variant="destructive"
					size="sm"
					disabled={busy || selectedNames.length === 0}
				>
					{#if busy}
						<Loader2 class="size-3.5 animate-spin" /> Deleting…
					{:else}
						<Trash2 class="size-3.5" />
						Delete {selectedNames.length || ''} branch{selectedNames.length === 1 ? '' : 'es'}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
