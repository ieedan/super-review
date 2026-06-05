<script lang="ts">
	import { MoreHorizontal, Trash2 } from 'lucide-svelte';
	import { actions, app } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import { harnessLabel } from '$lib/harness-logos';
	import HarnessLogo from './HarnessLogo.svelte';
	import * as DropdownMenu from './ui/dropdown-menu';
	import { confirmDelete } from './ui/confirm-delete-dialog';

	// Compact list of the active repo's documented slices, shown in the sidebar
	// when the Slices tab is active and no slice is open. Selecting one opens its
	// live diff (which swaps this list for the slice's file list). Multiple slices
	// from multiple authors coexist over the same branch, each scoped to its files.
	const slices = $derived(app.slices);

	function remove(id: string): void {
		void actions.deleteSlice(id);
	}

	// Slices are committed into the repo's .super-review/ folder, so clearing them
	// is the way to keep a PR tidy before merging. Confirm first since it removes
	// every documented tour for the repo.
	function clearAll(): void {
		const count = slices.length;
		confirmDelete({
			title: `Clear all ${count} slice${count === 1 ? '' : 's'}?`,
			description:
				'Removes every documented slice from this repo’s .super-review folder. ' +
				'Use this to clean up before merging a PR. This can’t be undone.',
			icon: 'warning',
			confirm: { text: 'Clear all' },
			onConfirm: async () => {
				await actions.clearSlices();
			}
		});
	}

	// Re-read nowTick so relative timestamps tick with the app's shared interval.
	function relative(updatedAt: number): string {
		void app.nowTick;
		return formatRelative(new Date(updatedAt).toISOString());
	}
</script>

{#if slices.length === 0}
	<div class="px-3 py-8 text-center text-xs text-muted-foreground">No slices yet</div>
{:else}
	<div
		class="flex items-center justify-between px-3 py-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
	>
		<span>{slices.length} slice{slices.length === 1 ? '' : 's'}</span>
		<button
			type="button"
			class="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
			title="Remove all slices from this repo (e.g. before merging a PR)"
			onclick={clearAll}
		>
			<Trash2 class="size-3" />
			Clear all
		</button>
	</div>
	<div class="flex flex-col gap-1 p-2 pt-0">
		{#each slices as slice (slice.id)}
			<div
				role="button"
				tabindex="0"
				class="group flex cursor-pointer items-start gap-2.5 rounded-md border border-transparent p-2 text-left transition-colors hover:bg-accent"
				onclick={() => actions.openSlice(slice.id)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						void actions.openSlice(slice.id);
					}
				}}
			>
				<div
					class="mt-0.5 grid size-6 flex-none place-items-center rounded-md border border-border bg-card"
					title={harnessLabel(slice.author.harness ?? 'other', slice.author.name)}
				>
					<HarnessLogo harness={slice.author.harness ?? 'other'} size={14} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5">
						<span class="truncate text-xs font-medium">{slice.title}</span>
					</div>
					<!-- Author chip: who documented this slice (agent or human). -->
					<div class="mt-0.5 flex items-center gap-1">
						<span
							class="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground"
						>
							<span class="truncate">{slice.author.name}</span>
						</span>
					</div>
					{#if slice.description}
						<p class="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
							{slice.description}
						</p>
					{/if}
					<div
						class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums"
					>
						<span>{relative(slice.updatedAt)}</span>
						<span>·</span>
						{#if slice.stepCount > 0}
							<span>{slice.stepCount} step{slice.stepCount === 1 ? '' : 's'}</span>
							<span>·</span>
						{/if}
						<span>{slice.fileCount} file{slice.fileCount === 1 ? '' : 's'}</span>
						{#if slice.additions != null}
							<span class="text-success">+{slice.additions}</span>
						{/if}
						{#if slice.deletions != null}
							<span class="text-destructive">−{slice.deletions}</span>
						{/if}
						{#if slice.branch}
							<span>·</span>
							<span class="truncate">{slice.branch}</span>
						{/if}
					</div>
				</div>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="grid size-6 flex-none place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground data-[state=open]:opacity-100"
						aria-label="Slice actions"
						onclick={(e: MouseEvent) => e.stopPropagation()}
					>
						<MoreHorizontal class="size-3.5" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Item variant="destructive" onSelect={() => remove(slice.id)}>
							<Trash2 class="size-3.5" />
							Delete
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		{/each}
	</div>
{/if}
