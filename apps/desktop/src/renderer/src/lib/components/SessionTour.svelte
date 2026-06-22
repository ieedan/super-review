<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import FileMinus from '@lucide/svelte/icons/file-minus';
	import FileEdit from '@lucide/svelte/icons/file-edit';
	import { actions, app } from '$lib/store.svelte';
	import { cn } from '$lib/utils';
	import FileIcon from './FileIcon.svelte';
	import { tourGroups, calloutsForFile } from '$lib/session-tour';

	// The open session's tour, grouped: each step's files (in reading order),
	// then a trailing "Other changes" group. Clicking a step scrolls the diff to
	// its header; clicking a file scrolls to that file's diff.
	const groups = $derived(tourGroups(app.activeSessionDetail, app.changedFiles) ?? []);

	function basename(p: string): string {
		const i = p.lastIndexOf('/');
		return i >= 0 ? p.slice(i + 1) : p;
	}

	// Toggle a file's "seen" state from the tour row. stopPropagation keeps the
	// click off the row's scroll-to-file handler so ticking the box doesn't also
	// jump the diff.
	function toggleSeen(e: MouseEvent, path: string): void {
		e.stopPropagation();
		void actions.toggleSeen(path);
	}
</script>

<div class="flex flex-col gap-3 p-2">
	{#each groups as group, gi (group.id)}
		{@const stepNumber = groups.slice(0, gi + 1).filter((g) => !g.synthetic).length}
		<div class="flex flex-col">
			<button
				type="button"
				class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
				onclick={() => actions.scrollToStep(group.id)}
			>
				{#if !group.synthetic}
					<span
						class="grid size-4 flex-none place-items-center rounded-full bg-foreground/10 text-[10px] font-semibold text-foreground tabular-nums"
					>
						{stepNumber}
					</span>
				{/if}
				<span class="min-w-0 flex-1 truncate text-xs font-semibold">
					{group.title}
				</span>
				<span class="flex-none text-[10px] text-muted-foreground tabular-nums">
					{group.files.length}
				</span>
			</button>
			<div class="mt-0.5 flex flex-col">
				{#each group.files as file (file.path)}
					{@const isActive = app.selectedFile === file.path}
					{@const isSeen = app.seenFiles.has(file.path)}
					<!-- Row wraps a "seen" toggle and the scroll-to-file button side by
					     side, mirroring the FileList sidebar so the tour surfaces the same
					     per-file seen checkmark. -->
					<div
						class={cn(
							'group flex w-full items-center gap-1.5 border-l-2 border-transparent py-1 pr-2 pl-3 select-none',
							isActive ? 'border-l-foreground bg-accent' : 'hover:bg-accent/50'
						)}
					>
						<button
							class={cn(
								'grid size-3.5 shrink-0 place-items-center rounded border outline-hidden',
								isSeen
									? 'text-success-foreground border-success bg-success'
									: 'border-border hover:border-foreground'
							)}
							onclick={(e) => toggleSeen(e, file.path)}
							aria-label={isSeen ? 'Mark unseen' : 'Mark seen'}
							type="button"
						>
							{#if isSeen}
								<Check class="size-2.5" />
							{/if}
						</button>
						<button
							type="button"
							class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-hidden"
							onclick={() => actions.scrollToFile(file.path)}
							title={file.path}
						>
							{#if app.showFileIcons}
								<FileIcon path={file.path} class="size-3.5 shrink-0" />
							{/if}
							<span class={cn('truncate text-xs', isSeen && 'text-muted-foreground line-through')}>
								{basename(file.path)}
							</span>
							<span class="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums">
								{#if file.status === 'deleted'}
									<FileMinus class="size-3 text-destructive" />
								{:else if file.status === 'renamed' || file.status === 'copied'}
									<FileEdit class="size-3 text-warning" />
								{:else if file.isBinary}
									<span class="text-muted-foreground">bin</span>
								{:else}
									{#if file.additions > 0}
										<span class="text-success">+{file.additions}</span>
									{/if}
									{#if file.deletions > 0}
										<span class="text-destructive">−{file.deletions}</span>
									{/if}
								{/if}
							</span>
						</button>
					</div>
					{#each calloutsForFile(app.activeSessionDetail, file.path) as callout (callout.id)}
						<button
							type="button"
							class="flex w-full items-center gap-1.5 py-0.5 pr-2 pl-8 text-left text-[10px] text-muted-foreground hover:text-foreground"
							onclick={() => actions.scrollToCallout(file.path, callout.id)}
							title={callout.body}
						>
							<span class="size-1 flex-none rounded-full bg-primary"></span>
							<span class="flex-none text-primary tabular-nums">
								{callout.startLine === callout.endLine
									? `L${callout.startLine}`
									: `L${callout.startLine}–${callout.endLine}`}
							</span>
							<span class="truncate">{callout.body}</span>
						</button>
					{/each}
				{/each}
			</div>
		</div>
	{/each}
</div>
