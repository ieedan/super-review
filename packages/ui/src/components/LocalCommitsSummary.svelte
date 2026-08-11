<script lang="ts">
	// The commit box's summary of the commits waiting to be pushed. A single row
	// under the Undo row ("2 more commits") that opens a panel on hover with every
	// local commit — when it landed, what it changed, and which files it touched —
	// so you can see what's stacked up without leaving the commit box for the
	// History tab.
	//
	// Built on the app's Popover primitive anchored to the row (like
	// PackageHoverCard) rather than a trigger, so hover and keyboard drive the
	// open state directly: hovering opens it, clicking pins it and moves focus
	// into the list so it can be scrolled with the arrow keys.

	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FileEdit from '@lucide/svelte/icons/file-edit';
	import FileMinus from '@lucide/svelte/icons/file-minus';
	import { onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Popover, PopoverContent } from './ui/popover';
	import FileIcon from './FileIcon.svelte';
	import { actions, app } from '@super-review/ui/store.svelte';
	import { cn, formatRelative } from '@super-review/ui/utils';
	import { LOCAL_COMMITS_LIMIT } from '@super-review/core/types';
	import type { LocalCommit, LocalCommitFile } from '@super-review/core/types';

	interface Props {
		// Commits on HEAD that aren't on any remote, the one the Undo row shows
		// included. The row appears from two up.
		count: number;
	}

	let { count }: Props = $props();

	// A commit lists this many files up front; the rest are one click away, so a
	// lockfile-sized commit doesn't push the commits below it out of reach.
	const FILES_PER_COMMIT = 10;
	// Shared by a file row and the "show more" row under it, so the toggle reads
	// as part of the list rather than a control bolted under it.
	const FILE_ROW_CLASS = 'flex w-full items-center gap-1.5 px-3 py-[3px] text-left text-[11px]';
	// Hover intent: long enough that passing over the row on the way to the diff
	// doesn't open the panel, short enough to feel immediate when you stop.
	const OPEN_DELAY_MS = 140;
	const CLOSE_DELAY_MS = 160;

	const more = $derived(Math.max(0, count - 1));
	const commits = $derived(app.localCommits);
	const totals = $derived.by(() => {
		let additions = 0;
		let deletions = 0;
		for (const c of commits) {
			additions += c.additions;
			deletions += c.deletions;
		}
		return { additions, deletions };
	});

	// Load as soon as the row is on screen (and again whenever HEAD moves), so the
	// panel is populated by the time a hover opens it rather than filling in
	// underneath the pointer. The action no-ops when the list is already current.
	$effect(() => {
		void app.lastCommit?.hash;
		void count;
		void actions.loadLocalCommits();
	});

	let rowEl = $state<HTMLElement | null>(null);
	let listEl = $state<HTMLElement | null>(null);
	let open = $state(false);
	// Set by a click: the panel stays put until it's dismissed, so its content can
	// be read and scrolled without keeping the pointer on it.
	let pinned = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function scheduleOpen(): void {
		clearTimeout(timer);
		if (open) return;
		timer = setTimeout(() => (open = true), OPEN_DELAY_MS);
	}

	function scheduleClose(): void {
		clearTimeout(timer);
		if (pinned) return;
		timer = setTimeout(() => (open = false), CLOSE_DELAY_MS);
	}

	function keepOpen(): void {
		clearTimeout(timer);
	}

	function close(): void {
		clearTimeout(timer);
		pinned = false;
		open = false;
		expanded.clear();
	}

	// Escape (or a click elsewhere) puts a pinned panel away and hands focus back
	// to the row, so keyboard navigation carries on from where it was.
	function dismiss(): void {
		const wasFocused = pinned;
		close();
		if (wasFocused) rowEl?.focus();
	}

	// Click (or Enter/Space) pins the panel and hands focus to the list, which is
	// the only way to scroll it without a pointer. Clicking again dismisses it.
	function togglePinned(): void {
		clearTimeout(timer);
		if (pinned) {
			close();
			return;
		}
		pinned = true;
		open = true;
		// The content mounts a tick after `open` flips on a cold open.
		queueMicrotask(() => listEl?.focus());
	}

	onDestroy(() => clearTimeout(timer));

	// Re-read nowTick so the timestamps tick over with the app's shared interval.
	function relative(authoredAt: number): string {
		void app.nowTick;
		return formatRelative(new Date(authoredAt).toISOString());
	}

	function fileName(path: string): string {
		return path.split('/').pop() ?? path;
	}

	function dirName(path: string): string {
		const cut = path.lastIndexOf('/');
		return cut === -1 ? '' : path.slice(0, cut);
	}

	// Commits whose full file list is showing, by hash. Cleared when the panel
	// closes so each open starts compact.
	const expanded = new SvelteSet<string>();

	function visibleFiles(commit: LocalCommit): LocalCommitFile[] {
		return expanded.has(commit.hash) ? commit.files : commit.files.slice(0, FILES_PER_COMMIT);
	}

	// Expanding also pins the panel: having just asked for more, the reader
	// shouldn't lose it to a stray pointer move.
	function toggleFiles(hash: string): void {
		if (expanded.has(hash)) expanded.delete(hash);
		else expanded.add(hash);
		pinned = true;
	}
</script>

<div class="border-t border-border bg-card/75 backdrop-blur-md">
	<button
		bind:this={rowEl}
		type="button"
		aria-expanded={open}
		class="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
		onpointerenter={scheduleOpen}
		onpointerleave={scheduleClose}
		onclick={togglePinned}
	>
		<span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
			{more} more commit{more === 1 ? '' : 's'}
		</span>
		<ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
	</button>
</div>

<Popover
	{open}
	onOpenChange={(next) => {
		if (!next) close();
	}}
>
	<PopoverContent
		customAnchor={rowEl}
		side="right"
		align="end"
		sideOffset={8}
		trapFocus={false}
		onOpenAutoFocus={(e) => e.preventDefault()}
		onCloseAutoFocus={(e) => e.preventDefault()}
		onEscapeKeydown={dismiss}
		onInteractOutside={dismiss}
		class="flex max-h-[65vh] w-[26rem] flex-col gap-0 overflow-hidden p-0"
	>
		<div
			class="flex min-h-0 flex-1 flex-col"
			onpointerenter={keepOpen}
			onpointerleave={scheduleClose}
			role="presentation"
		>
			<header class="flex items-center gap-2 border-b border-border px-3 py-2">
				<span class="min-w-0 flex-1 truncate text-xs font-medium">
					{count} commit{count === 1 ? '' : 's'} not pushed
				</span>
				<span class="shrink-0 text-[11px] tabular-nums">
					<span class="text-success">+{totals.additions}</span>
					<span class="ml-0.5 text-destructive">−{totals.deletions}</span>
				</span>
			</header>

			{#if commits.length === 0}
				<p class="px-3 py-6 text-center text-xs text-muted-foreground">Loading commits…</p>
			{:else}
				<!-- Focusable so a pinned panel scrolls with the arrow keys. -->
				<div bind:this={listEl} tabindex="-1" class="min-h-0 flex-1 overflow-y-auto outline-none">
					{#each commits as commit (commit.hash)}
						{@const hidden = commit.files.length - FILES_PER_COMMIT}
						<section class="border-b border-border/60 pb-2 last:border-b-0">
							<!-- Sticky so you always know which commit the files below belong
							     to while scrolling a long stack. -->
							<div class="sticky top-0 z-10 bg-popover px-3 pt-2 pb-1.5">
								<div class="flex items-baseline gap-2">
									<span class="min-w-0 flex-1 truncate text-xs font-medium" title={commit.subject}>
										{commit.subject}
									</span>
									<span class="shrink-0 text-[11px] tabular-nums">
										<span class="text-success">+{commit.additions}</span>
										<span class="ml-0.5 text-destructive">−{commit.deletions}</span>
									</span>
								</div>
								<div
									class="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums"
								>
									<span>{relative(commit.authoredAt)}</span>
									<span class="font-mono">{commit.shortHash}</span>
									<span class="ml-auto">
										{commit.files.length}
										{commit.files.length === 1 ? 'file' : 'files'}
									</span>
								</div>
							</div>

							<ul>
								{#each visibleFiles(commit) as file (file.path)}
									<li
										class={FILE_ROW_CLASS}
										title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
									>
										{#if app.showFileIcons}
											<FileIcon path={file.path} class="size-3.5 shrink-0" />
										{/if}
										<span class="max-w-[60%] shrink-0 truncate">{fileName(file.path)}</span>
										<span class="min-w-0 flex-1 truncate text-muted-foreground">
											{dirName(file.path)}
										</span>
										<span class="flex shrink-0 items-center gap-0.5 tabular-nums">
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
									</li>
								{/each}
								{#if hidden > 0}
									<li>
										<button
											type="button"
											class={cn(
												FILE_ROW_CLASS,
												'text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset'
											)}
											onclick={() => toggleFiles(commit.hash)}
										>
											<ChevronRight
												class={cn(
													'size-3 shrink-0 transition-transform',
													expanded.has(commit.hash) && 'rotate-90'
												)}
											/>
											{#if expanded.has(commit.hash)}
												Show less
											{:else}
												Show {hidden} more {hidden === 1 ? 'file' : 'files'}
											{/if}
										</button>
									</li>
								{:else if commit.files.length === 0}
									<li class={cn(FILE_ROW_CLASS, 'text-muted-foreground')}>
										A merge, so nothing of its own
									</li>
								{/if}
							</ul>
						</section>
					{/each}

					{#if commits.length >= LOCAL_COMMITS_LIMIT && commits.length < count}
						<!-- The read is capped, so say so rather than let the header's count
						     imply the list below is the whole stack. -->
						<p class="px-3 py-2 text-[11px] text-muted-foreground">
							Showing the {commits.length} most recent
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</PopoverContent>
</Popover>
