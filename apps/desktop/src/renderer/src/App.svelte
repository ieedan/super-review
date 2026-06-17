<script lang="ts">
	import { onMount } from 'svelte';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import FolderSearch from '@lucide/svelte/icons/folder-search';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Badge } from '$lib/components/ui/badge';
	import TopBar from '$lib/components/TopBar.svelte';
	import FileList from '$lib/components/FileList.svelte';
	import DiffView from '$lib/components/DiffView.svelte';
	import SessionsEmptyState from '$lib/components/SessionsEmptyState.svelte';
	import CommentsPanel from '$lib/components/CommentsPanel.svelte';
	import ConflictDialog from '$lib/components/ConflictDialog.svelte';
	import ForkDialog from '$lib/components/ForkDialog.svelte';
	import MergedSwitchDialog from '$lib/components/MergedSwitchDialog.svelte';
	import MergedRemoveDialog from '$lib/components/MergedRemoveDialog.svelte';
	import StashPromptDialog from '$lib/components/StashPromptDialog.svelte';
	import SwitchBranchDialog from '$lib/components/SwitchBranchDialog.svelte';
	import BranchMenu from '$lib/components/BranchMenu.svelte';
	import RepositoryMenu from '$lib/components/RepositoryMenu.svelte';
	import AddRepoDialog from '$lib/components/AddRepoDialog.svelte';
	import PublishRepoDialog from '$lib/components/PublishRepoDialog.svelte';
	import CreateBranchDialog from '$lib/components/CreateBranchDialog.svelte';
	import CleanupBranchesDialog from '$lib/components/CleanupBranchesDialog.svelte';
	import SettingsDialog from '$lib/components/SettingsDialog.svelte';
	import RepositorySettingsDialog from '$lib/components/RepositorySettingsDialog.svelte';
	import GithubSignInDialog from '$lib/components/GithubSignInDialog.svelte';
	import { ConfirmDeleteDialog } from '$lib/components/ui/confirm-delete-dialog';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Resizable from '$lib/components/ui/resizable';
	import type { PaneAPI } from 'paneforge';
	import { actions, setError, app } from '$lib/store.svelte';
	import { initDiffHighlighter } from '$lib/diff-highlighter';
	import { initDiffWorkerPool } from '$lib/diff-worker-pool';
	import { setAnimations } from '$lib/hooks/use-animations.svelte';
	import { HOTKEY_ACTIONS, matchesHotkey, type HotkeyAction } from '@shared/hotkeys';
	import { isEditableTarget } from '$lib/utils';
	import { Agentation, type AnnotationProps } from 'sv-agentation';

	// Dev-only in-app inspector for annotating elements to hand back as feedback.
	// `import.meta.env.DEV` is Vite's compile-time flag, so the component and its
	// import are tree-shaken out of production builds. The renderer has no SSR, so
	// no browser guard is needed. Absolute path to the desktop app so Agentation's
	// source links resolve to the real files on disk.
	const annotationProps: AnnotationProps = {
		workspaceRoot: '/Users/ieedan/Documents/github/super-local-review/apps/desktop'
	};

	// Share the user's animation preference with the whole component tree so
	// shadcn-svelte primitives can opt in/out of their motion classes via
	// useAnimations(). Off by default; reactive to the setting.
	setAnimations(() => app.animationsEnabled);

	const ORIGIN_POLL_MS = 2 * 60 * 1000;
	const TICK_MS = 30 * 1000;
	const CHECKS_POLL_MS = 20 * 1000;

	// Kick off the shiki highlighter preload early so the very first diff —
	// including the settings preview — has a warm singleton. This also serves as
	// the main-thread fallback if the worker pool can't start.
	initDiffHighlighter();

	// Spin up the diff render worker pool so highlighting/diff-AST work happens
	// off the main thread, keeping the UI responsive while diffs paint.
	initDiffWorkerPool();

	// Imperative handle on the sidebar pane, used by Cmd+B and the
	// SidebarTrigger button to collapse/expand without dragging.
	let sidebarPane = $state<PaneAPI | undefined>();

	// Error toast state. `errorDetailsOpen` toggles the raw-message <pre>;
	// `errorCopied` flips the copy button to a checkmark for a beat. Both reset
	// whenever the error changes so a new toast always opens collapsed.
	let errorDetailsOpen = $state(false);
	let errorCopied = $state(false);
	let copyResetId: number | undefined;
	$effect(() => {
		// Re-runs on every new (or cleared) error message.
		void app.error;
		errorDetailsOpen = false;
		errorCopied = false;
	});
	function copyError(): void {
		if (!app.error) return;
		void navigator.clipboard.writeText(app.error);
		errorCopied = true;
		clearTimeout(copyResetId);
		copyResetId = window.setTimeout(() => (errorCopied = false), 1500);
	}

	// Restore the persisted collapsed state once the pane mounts. The pane layout
	// is the source of truth (assigning app.sidebarCollapsed alone won't move it),
	// so drive it imperatively; expand()/collapse() no-op when already in state.
	// Deferred a frame so PaneForge has committed its initial layout first.
	let sidebarRestored = false;
	$effect(() => {
		// Re-arm when the pane unmounts (e.g. closing the repo) so reopening
		// restores the persisted state again.
		if (!sidebarPane) {
			sidebarRestored = false;
			return;
		}
		if (sidebarRestored) return;
		sidebarRestored = true;
		const pane = sidebarPane;
		const collapsed = app.sidebarCollapsed;
		requestAnimationFrame(() => (collapsed ? pane.collapse() : pane.expand()));
	});

	// All configurable app-wide shortcuts dispatch from one place: each action
	// maps to its handler here, and the single window keydown below (mounted via
	// <svelte:window>, so Svelte tears it down for us) runs whichever binding
	// matched. Adding a shortcut is one entry, not another addEventListener pair.
	const hotkeyHandlers: Record<HotkeyAction, (e: KeyboardEvent) => void> = {
		// Toggle the fuzzy file-search palette. No editable-target guard — the
		// default (Cmd/Ctrl+P) is a deliberate combo that won't collide with typing.
		searchFilesPalette: (e) => {
			e.preventDefault();
			actions.toggleCommandMenu();
		},
		// Jump focus to the sidebar's search box. A bare-key binding (default `/`)
		// is skipped while typing in an editable target so it doesn't hijack the
		// commit/comment composers; a modifier combo is deliberate and fires anywhere.
		searchFilesSidebar: (e) => {
			const hk = app.hotkeys.searchFilesSidebar;
			if (!hk.mod && !hk.alt && isEditableTarget(e.target)) return;
			e.preventDefault();
			actions.focusSidebarSearch();
		},
		// Collapse/expand the sidebar by driving the pane handle directly, keeping
		// the layout the single source of truth (onCollapse/onExpand sync back).
		toggleSidebar: (e) => {
			if (!app.activeRepo || !sidebarPane) return;
			e.preventDefault();
			if (app.sidebarCollapsed) sidebarPane.expand();
			else sidebarPane.collapse();
		},
		// Open/close the right-hand comments sidebar (default Cmd/Ctrl+L).
		toggleCommentsSidebar: (e) => {
			if (!app.activeRepo) return;
			e.preventDefault();
			actions.toggleCommentsSidebar();
		},
		// Open the settings dialog from anywhere (default Cmd/Ctrl+Comma).
		openSettings: (e) => {
			e.preventDefault();
			actions.openSettingsDialog();
		},
		// Mark the open file seen and jump to the next change (default
		// Cmd/Ctrl+Enter). Skipped while typing so it doesn't steal the same combo
		// from the commit/comment composers, which use it to submit.
		markSeenNext: (e) => {
			if (isEditableTarget(e.target) || !app.selectedFile) return;
			e.preventDefault();
			void actions.markSeenAndAdvance(app.selectedFile);
		}
	};

	function onWindowKeydown(e: KeyboardEvent): void {
		for (const action of HOTKEY_ACTIONS) {
			if (matchesHotkey(e, app.hotkeys[action])) {
				hotkeyHandlers[action](e);
				return;
			}
		}
	}

	// Persistent app-level listeners, bound declaratively on <svelte:window> /
	// <svelte:document> below so Svelte handles teardown. Defined here (not inside
	// onMount) so the template can reference them.

	// Refresh the working tree whenever the window regains focus so file changes
	// made externally are reflected without a manual click.
	const onFocus = (): void => {
		if (app.activeRepo) void actions.refresh();
	};

	// The macOS traffic lights are drawn by the OS at a fixed point size, but our
	// header scales with the renderer's zoom factor — so on every zoom change we
	// ask the main process to re-center them. Zoom changes the layout viewport,
	// which fires 'resize'; coalesce with rAF to avoid spamming during live window
	// drags. No-op off macOS.
	let syncQueued = false;
	const syncWindowControls = (): void => {
		if (window.api.platform !== 'darwin' || syncQueued) return;
		syncQueued = true;
		requestAnimationFrame(() => {
			syncQueued = false;
			window.api.windowControls.sync();
		});
	};

	// Periodically fetch origin so branch base diffs and ahead/behind stay fresh.
	// Only runs while the window is visible to avoid background work on
	// minimized/hidden windows; onVisibility toggles it.
	let pollId: number | undefined;
	const startPoll = (): void => {
		if (pollId !== undefined) return;
		pollId = window.setInterval(() => {
			if (app.activeRepo && document.visibilityState === 'visible') {
				void actions.fetchAndRefresh();
			}
		}, ORIGIN_POLL_MS);
	};
	const stopPoll = (): void => {
		if (pollId !== undefined) {
			window.clearInterval(pollId);
			pollId = undefined;
		}
	};
	const onVisibility = (): void => {
		if (document.visibilityState === 'visible') startPoll();
		else stopPoll();
	};

	// PaneForge sizes panes in percentages, but we want a hard px floor on the
	// sidebar so the combined header (tabs + totals + trigger) never overflows.
	// Measure the group width and convert 450px → a percentage minSize, capped so
	// it can't exceed the pane's max. 22 is a sane fallback before first measure.
	const SIDEBAR_MIN_PX = 450;
	let paneGroupEl = $state<HTMLElement | null>(null);
	let groupWidth = $state(0);
	const sidebarMinSize = $derived(
		groupWidth > 0 ? Math.min(50, (SIDEBAR_MIN_PX / groupWidth) * 100) : 22
	);

	$effect(() => {
		const el = paneGroupEl;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			groupWidth = entries[0].contentRect.width;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	// Point the main-process fs watcher at the active repo so session changes
	// (an agent's CLI save, a purge, another window) push live updates, and
	// re-seed the badge count whenever the repo changes. watch() replaces any
	// prior subscription for this window, so no explicit teardown is needed.
	$effect(() => {
		const repoId = app.activeRepo?.id ?? null;
		void window.api.sessions.watch(repoId);
		void actions.refreshSessionCount();
	});

	// Same live-watch for the repo's local comments, so a comment added in another
	// window — or resolved by an agent via the CLI — shows up without a refresh.
	$effect(() => {
		const repoId = app.activeRepo?.id ?? null;
		void window.api.comments.watch(repoId);
	});

	onMount(() => {
		void actions.init();

		const offRepoChanged = window.api.events.onRepoChanged((repo) => {
			if (!repo) return;
			// Different repo → a real switch (e.g. triggered from another window).
			if (repo.id !== app.activeRepo?.id) {
				void actions.switchRepo(repo.id);
				return;
			}
			// Same repo → the main process did a background metadata refresh
			// (favicon, remote URL, etc). Merge the new info in-place so the UI
			// updates without re-running the whole switch pipeline.
			actions.updateActiveRepoMetadata(repo);
		});

		// Removing a repo trashes its folder in the background; surface the rare
		// failure (the repo is already gone from the app, but its files remain).
		const offTrashFailed = window.api.events.onRepoTrashFailed((name) => {
			setError(`Couldn't move "${name}" to the trash. Its files are still on disk.`);
		});

		// An agent's CLI (or another window) changed this repo's sessions on disk —
		// keep the badge live and reload the list if the Sessions tab is showing.
		const offSessionsChanged = window.api.events.onSessionsChanged((repoId) => {
			void actions.onSessionsChanged(repoId);
		});

		// An agent's CLI (or another window) changed this repo's local comments on
		// disk — reload the active context's list.
		const offCommentsChanged = window.api.events.onCommentsChanged((repoId) => {
			void actions.onCommentsChanged(repoId);
		});

		// An account's GitHub token started or stopped failing authentication —
		// keep the "sign in again" prompt in sync.
		const offGithubAuthChanged = window.api.events.onGithubAuthChanged((errors) => {
			actions.onGithubAuthChanged(errors);
		});

		// Center the traffic lights once now; the resize binding handles every
		// subsequent zoom change.
		syncWindowControls();

		// Kick off origin polling if we're currently visible; the visibilitychange
		// binding starts/stops it from here on.
		if (document.visibilityState === 'visible') startPoll();

		// Drive the "last refreshed Xm ago" label.
		const tickId = window.setInterval(() => actions.tickNow(), TICK_MS);

		// Poll the branch PR's CI/workflow status so the action button's indicator
		// stays current while checks run. Only while visible and a PR is shown.
		const checksId = window.setInterval(() => {
			if (app.branchPR && document.visibilityState === 'visible') {
				void actions.refreshBranchPRChecks();
			}
		}, CHECKS_POLL_MS);

		return () => {
			offRepoChanged();
			offTrashFailed();
			offSessionsChanged();
			offCommentsChanged();
			offGithubAuthChanged();
			stopPoll();
			window.clearInterval(tickId);
			window.clearInterval(checksId);
		};
	});
</script>

<!--
  SidebarProvider gives us Cmd/Ctrl+B + a shared sidebar context (consumed by
  Sidebar.Trigger in TopBar). Open state binding flow:
    user toggles → onOpenChange → sidebarPane.expand/collapse() →
    PaneForge fires onCollapse/onExpand → app.sidebarCollapsed updates →
    open getter re-reads. The pane layout stays the single source of truth,
    so dragging the handle to collapse also stays in sync without looping.
-->
<svelte:window onfocus={onFocus} onresize={syncWindowControls} onkeydown={onWindowKeydown} />
<svelte:document onvisibilitychange={onVisibility} />

<Sidebar.Provider
	open={!app.sidebarCollapsed}
	onOpenChange={(open) => {
		if (!sidebarPane) return;
		if (open) sidebarPane.expand();
		else sidebarPane.collapse();
	}}
	class="flex h-full w-full flex-col"
>
	<TopBar />
	<main class="flex min-h-0 flex-1">
		{#if !app.activeRepo}
			<div class="grid h-full w-full place-items-center">
				<div class="w-full max-w-md px-6">
					<h1 class="text-center text-2xl font-semibold">Super Review</h1>
					<p class="mt-2 text-center text-sm text-muted-foreground">
						Open a git repository to start reviewing changes.
					</p>
					<div class="mt-6 grid gap-3">
						<button
							type="button"
							class="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
							onclick={() => actions.openRepo()}
						>
							<FolderOpen class="mt-0.5 size-5 text-muted-foreground" />
							<div class="min-w-0 flex-1">
								<div class="text-sm font-medium">Open a repository</div>
								<div class="text-xs text-muted-foreground">Open a single git repository.</div>
							</div>
						</button>
						<button
							type="button"
							class="relative flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
							onclick={() => actions.openFolder()}
						>
							<Badge variant="secondary" class="absolute top-3 right-3">Recommended</Badge>
							<FolderSearch class="mt-0.5 size-5 text-muted-foreground" />
							<div class="min-w-0 flex-1">
								<div class="text-sm font-medium">Open a folder</div>
								<div class="text-xs text-muted-foreground">
									Specify a folder to search for git repositories.
								</div>
							</div>
						</button>
					</div>
				</div>
			</div>
		{:else}
			<Resizable.PaneGroup
				bind:ref={paneGroupEl}
				direction="horizontal"
				autoSaveId="sr-main-layout"
				class="h-full w-full"
			>
				<Resizable.Pane
					bind:this={sidebarPane}
					defaultSize={Math.max(22, sidebarMinSize)}
					minSize={sidebarMinSize}
					maxSize={50}
					collapsible
					collapsedSize={0}
					onCollapse={() => actions.setSidebarCollapsed(true)}
					onExpand={() => actions.setSidebarCollapsed(false)}
				>
					<FileList />
				</Resizable.Pane>
				<Resizable.Handle class="transition-colors hover:bg-foreground/20" />
				<Resizable.Pane defaultSize={app.commentsSidebarOpen ? 56 : 78}>
					{#if app.contextTab === 'sessions' && !app.activeSessionId}
						<SessionsEmptyState />
					{:else}
						<DiffView />
					{/if}
				</Resizable.Pane>
				{#if app.commentsSidebarOpen}
					<Resizable.Handle class="transition-colors hover:bg-foreground/20" />
					<Resizable.Pane defaultSize={22} minSize={15} maxSize={40}>
						<CommentsPanel />
					</Resizable.Pane>
				{/if}
			</Resizable.PaneGroup>
		{/if}
	</main>

	{#if app.error}
		<div
			role="alert"
			class="fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive shadow-lg backdrop-blur"
		>
			<div class="flex items-start gap-2">
				<TriangleAlert class="size-5 shrink-0" />
				<span class="flex-1 pt-0.5 font-medium">An error occurred</span>
				<button
					class="rounded p-0.5 hover:bg-destructive/20"
					onclick={() => setError(null)}
					aria-label="Dismiss"
				>
					<X class="size-3.5" />
				</button>
			</div>
			<div class="flex items-center gap-1.5 pl-7">
				<button
					class="rounded border border-destructive/50 px-2 py-1 text-xs hover:bg-destructive/20"
					onclick={() => (errorDetailsOpen = !errorDetailsOpen)}
					aria-expanded={errorDetailsOpen}
				>
					{errorDetailsOpen ? 'Hide Details' : 'Show Details'}
				</button>
				<Tooltip.Provider delayDuration={150}>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									class="rounded border border-destructive/50 p-1 hover:bg-destructive/20"
									onclick={copyError}
									aria-label="Copy error"
								>
									{#if errorCopied}
										<Check class="size-3.5" />
									{:else}
										<Copy class="size-3.5" />
									{/if}
								</button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content
							side="top"
							class="border border-border bg-popover text-popover-foreground shadow-md"
							arrowClasses="bg-popover fill-popover"
						>
							{errorCopied ? 'Copied' : 'Copy error'}
						</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			</div>
			{#if errorDetailsOpen}
				<pre
					class="ml-7 max-h-48 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-2 font-mono text-xs whitespace-pre-wrap">{app.error}</pre>
			{/if}
		</div>
	{/if}
</Sidebar.Provider>

<ConflictDialog />
<ForkDialog />
<RepositorySettingsDialog />
<MergedSwitchDialog />
<MergedRemoveDialog />
<StashPromptDialog />
<SwitchBranchDialog />
<BranchMenu />
<RepositoryMenu />
<AddRepoDialog />
<PublishRepoDialog />
<CreateBranchDialog />
<CleanupBranchesDialog />
<SettingsDialog />
<GithubSignInDialog />
<CommandPalette />
<ConfirmDeleteDialog />

{#if import.meta.env.DEV}
	<Agentation {...annotationProps} />
{/if}
