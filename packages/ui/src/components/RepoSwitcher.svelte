<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import { VirtualList } from '@super-review/ui/virtual-list';
	import { Button, buttonVariants } from './ui/button';
	import * as Popover from './ui/popover';
	import * as Command from './ui/command';
	import { actions, app } from '@super-review/ui/store.svelte';
	import { repoFrecency } from '@super-review/ui/repo-frecency.svelte';
	import { confirmDelete } from './ui/confirm-delete-dialog';
	import { cn, groupReposByOwner } from '@super-review/ui/utils';
	import RepoIcon from './RepoIcon.svelte';
	import type { RepoInfo } from '@super-review/core/types';

	const ITEM_SIZE = 36;
	const HEADER_SIZE = 28;
	// The VirtualList is the scroll container. Cap it so it plus the surrounding
	// Command.Group's `p-1` (8px) fits within Command.List's 320px max-height —
	// otherwise the group overflows and the last row's bottom padding gets
	// clipped.
	const MAX_LIST_HEIGHT = 312;
	const OTHER_OWNER = 'Other';

	type Row = { kind: 'header'; label: string } | { kind: 'repo'; repo: RepoInfo };

	let filter = $state('');

	// Refresh dirty markers on open and clear the filter on close. Keying off
	// `open` (rather than the popover's onOpenChange) covers every close path:
	// selecting a repo, the context-menu actions, and the dialogs all close the
	// picker by setting `open` directly, which never fires onOpenChange.
	$effect(() => {
		if (app.repoPickerOpen) void actions.refreshDirtyRepos();
		else filter = '';
	});

	async function pick(id: string): Promise<void> {
		app.repoPickerOpen = false;
		await actions.switchRepo(id);
	}

	function openAddRepo(): void {
		app.repoPickerOpen = false;
		actions.openAddRepoDialog();
	}

	// Right-click a repo row: pop the native OS context menu and run the chosen
	// action. "Remove" de-registers the repo from the app and, by default, leaves
	// the files on disk — the confirmation offers an opt-in to trash the folder.
	async function showContextMenu(e: MouseEvent, repo: RepoInfo): Promise<void> {
		e.preventDefault();
		const revealLabel =
			app.platform === 'win32'
				? 'Reveal in Explorer'
				: app.platform === 'linux'
					? 'Reveal in File Manager'
					: 'Reveal in Finder';
		const action = await window.api.menu.showRepoContextMenu({
			name: repo.name,
			revealLabel
		});
		if (action === 'remove') {
			confirmRemove(repo);
		} else if (action === 'copyPath') {
			await actions.copyToClipboard(repo.path);
		} else if (action === 'reveal') {
			await window.api.shell.showItemInFolder(repo.path);
		} else if (action === 'settings') {
			await actions.switchRepo(repo.id);
			actions.openRepoSettingsDialog();
			app.repoPickerOpen = false;
		}
	}

	// Mirror GitHub Desktop's remove dialog: a warning icon, the repo's path, and
	// an opt-in checkbox to also move the repo's folder to the OS trash.
	function confirmRemove(repo: RepoInfo): void {
		const trashLabel = app.platform === 'win32' ? 'Recycle Bin' : 'Trash';
		confirmDelete({
			title: 'Remove repository',
			icon: 'warning',
			description: `Are you sure you want to remove the repository "${repo.name}" from super-review?`,
			details: {
				caption: 'The repository will be removed from super-review:',
				value: repo.path
			},
			checkbox: {
				label: `Also move this repository to ${trashLabel}`,
				default: false
			},
			confirm: { text: 'Remove' },
			onConfirm: async ({ checked }) => {
				await actions.removeRepo(repo.id, checked);
				// Close the picker once the removal lands so the user drops straight
				// onto the newly-active repo instead of back into the open list.
				app.repoPickerOpen = false;
			}
		});
	}

	// Mirror GitHub Desktop's repo picker: a "Recent" section of the few most
	// relevant repos, followed by every repo grouped under its owner (recent
	// repos still appear in their owner group too). Filtering is applied here —
	// rather than via Command's built-in matcher — because the list is
	// virtualized and its items are not all present in the DOM. While filtering,
	// the Recent section is dropped and only the owner groups are shown.
	//
	// The section is ranked by frecency (frequency blended with recency) rather
	// than raw recency, so the repos you reach for most stay near the top and
	// don't get bumped the instant you glance at another repo.
	const rows = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		const filtered = app.repos.filter(
			(r) =>
				needle === '' ||
				r.name.toLowerCase().includes(needle) ||
				r.path.toLowerCase().includes(needle)
		);

		const result: Row[] = [];

		if (needle === '') {
			// The section size is user-configurable (Settings → Behavior); 0 hides
			// the section via the empty-slice + length guard below.
			//
			// `repoFrecency.items` is the repo ids ordered by frecency. Rank by that
			// position; repos never opened on this machine have no frecency entry and
			// simply don't appear in Recent (they're still reachable via the owner
			// groups below).
			const rank = new Map(repoFrecency.items.map((id, i) => [id, i]));
			const recent = filtered
				.filter((r) => rank.has(r.id))
				.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
				.slice(0, app.recentRepoCount);
			if (recent.length > 0) {
				result.push({ kind: 'header', label: 'Recent' });
				for (const repo of recent) result.push({ kind: 'repo', repo });
			}
		}

		// Group by owner. Repos without a GitHub owner fall under "Other".
		const groups = groupReposByOwner(filtered, OTHER_OWNER);

		const ownerNames = [...groups.keys()].sort((a, b) => {
			// Keep the catch-all bucket last; otherwise sort owners alphabetically.
			if (a === OTHER_OWNER) return 1;
			if (b === OTHER_OWNER) return -1;
			return a.localeCompare(b, undefined, { sensitivity: 'base' });
		});

		for (const owner of ownerNames) {
			result.push({ kind: 'header', label: owner });
			const repos = groups
				.get(owner)!
				.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
			for (const repo of repos) result.push({ kind: 'repo', repo });
		}

		return result;
	});

	function rowSize(index: number): number {
		return rows[index]?.kind === 'header' ? HEADER_SIZE : ITEM_SIZE;
	}

	const listHeight = $derived(
		Math.min(
			MAX_LIST_HEIGHT,
			Math.max(
				ITEM_SIZE,
				rows.reduce((sum, row) => sum + (row.kind === 'header' ? HEADER_SIZE : ITEM_SIZE), 0)
			)
		)
	);
</script>

<Popover.Root bind:open={app.repoPickerOpen}>
	<Popover.Trigger class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'max-w-[260px]')}>
		{#if app.activeRepo}
			<RepoIcon repo={app.activeRepo} size="sm" />
		{/if}
		<span class="truncate">{app.activeRepo?.name ?? 'Open repository'}</span>
		<ChevronDown class="size-3.5 text-muted-foreground" />
	</Popover.Trigger>
	<Popover.Content align="start" class="w-[26rem] p-0">
		<Command.Root shouldFilter={false}>
			<!-- Sticky header: filter on the left, primary Add button on the right.
           Both stay visible while the repo list scrolls. -->
			<div class="flex items-center gap-2 border-b border-border p-2">
				<div
					class="flex h-8 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2"
				>
					<Search class="size-3.5 shrink-0 text-muted-foreground" />
					<CommandPrimitive.Input
						bind:value={filter}
						placeholder="Filter…"
						class="flex h-full w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
					/>
				</div>
				<Button size="sm" class="h-8 shrink-0 gap-1.5" onclick={openAddRepo}>
					<Plus class="size-3.5" />
					Add repository
				</Button>
			</div>

			<Command.List class="max-h-[320px] overflow-hidden">
				{#if app.repos.length === 0}
					<div class="px-3 py-6 text-center text-xs text-muted-foreground">No repositories yet</div>
				{:else if rows.length === 0}
					<div class="px-3 py-6 text-center text-xs text-muted-foreground">No matches</div>
				{:else}
					<Command.Group>
						<VirtualList
							width="100%"
							itemSize={rowSize}
							itemCount={rows.length}
							height={listHeight}
						>
							{#snippet item({ index, style })}
								{@const row = rows[index]}
								<div {style}>
									{#if row.kind === 'header'}
										<div
											class="flex h-full items-center truncate px-2 text-xs font-semibold text-muted-foreground"
										>
											{row.label}
										</div>
									{:else}
										{@const repo = row.repo}
										<Command.Item
											value={`${index}-${repo.name} ${repo.path}`}
											onSelect={() => pick(repo.id)}
											oncontextmenu={(e) => showContextMenu(e, repo)}
											class={cn(
												'group flex items-center gap-2',
												repo.id === app.activeRepo?.id && 'bg-accent/60'
											)}
										>
											<RepoIcon {repo} size="md" />
											<span class="min-w-0 flex-1 truncate font-medium">{repo.name}</span>
											<!-- Dot marks a repo with uncommitted changes. Removing a
                           repo now lives in the right-click context menu. -->
											{#if app.dirtyRepoIds.has(repo.id)}
												<span
													class="mr-1 size-2 shrink-0 rounded-full bg-sky-500"
													aria-label="Uncommitted changes"
												></span>
											{/if}
										</Command.Item>
									{/if}
								</div>
							{/snippet}
						</VirtualList>
					</Command.Group>
				{/if}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
