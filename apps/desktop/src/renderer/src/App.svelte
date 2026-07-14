<script lang="ts">
	import { onMount } from 'svelte';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import FolderSearch from '@lucide/svelte/icons/folder-search';
	import { Badge } from '@super-review/ui/components/ui/badge';
	import TopBar from '@super-review/ui/components/TopBar.svelte';
	import FileList from '@super-review/ui/components/FileList.svelte';
	import DiffView from '@super-review/ui/components/DiffView.svelte';
	import SessionsEmptyState from '@super-review/ui/components/SessionsEmptyState.svelte';
	import CommitsEmptyState from '@super-review/ui/components/CommitsEmptyState.svelte';
	import CommentsPanel from '@super-review/ui/components/CommentsPanel.svelte';
	import ConflictDialog from '@super-review/ui/components/ConflictDialog.svelte';
	import ForkDialog from '@super-review/ui/components/ForkDialog.svelte';
	import MergedSwitchDialog from '@super-review/ui/components/MergedSwitchDialog.svelte';
	import MergedRemoveDialog from '@super-review/ui/components/MergedRemoveDialog.svelte';
	import StashPromptDialog from '@super-review/ui/components/StashPromptDialog.svelte';
	import StashCollisionDialog from '@super-review/ui/components/StashCollisionDialog.svelte';
	import SwitchBranchDialog from '@super-review/ui/components/SwitchBranchDialog.svelte';
	import ChangesetDialog from '@super-review/ui/components/ChangesetDialog.svelte';
	import ChangesetReviewDialog from '@super-review/ui/components/ChangesetReviewDialog.svelte';
	import ConfigureAiDialog from '@super-review/ui/components/ConfigureAiDialog.svelte';
	import BranchMenu from '@super-review/ui/components/BranchMenu.svelte';
	import RepositoryMenu from '@super-review/ui/components/RepositoryMenu.svelte';
	import AddRepoDialog from '@super-review/ui/components/AddRepoDialog.svelte';
	import PublishRepoDialog from '@super-review/ui/components/PublishRepoDialog.svelte';
	import CreateBranchDialog from '@super-review/ui/components/CreateBranchDialog.svelte';
	import CleanupBranchesDialog from '@super-review/ui/components/CleanupBranchesDialog.svelte';
	import SettingsDialog from '@super-review/ui/components/SettingsDialog.svelte';
	import FeedbackDialog from '@super-review/ui/components/FeedbackDialog.svelte';
	import ErrorToasts from '@super-review/ui/components/ErrorToasts.svelte';
	import RepositorySettingsDialog from '@super-review/ui/components/RepositorySettingsDialog.svelte';
	import GithubSignInDialog from '@super-review/ui/components/GithubSignInDialog.svelte';
	import { ConfirmDeleteDialog } from '@super-review/ui/components/ui/confirm-delete-dialog';
	import CommandPalette from '@super-review/ui/components/CommandPalette.svelte';
	import * as Sidebar from '@super-review/ui/components/ui/sidebar';
	import * as Resizable from '@super-review/ui/components/ui/resizable';
	import type { PaneAPI } from 'paneforge';
	import { actions, setError, app, taskBranchTarget } from '@super-review/ui/store.svelte';
	import { initDiffHighlighter } from '@super-review/ui/diff-highlighter';
	import { initDiffWorkerPool } from '@super-review/ui/diff-worker-pool';
	import { setAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import { setMarkdownRepoContext } from '@super-review/ui/markdown';
	import { githubHostRepo } from '@super-review/ui/store.svelte';
	import { HOTKEY_ACTIONS, matchesHotkey, type HotkeyAction } from '@shared/hotkeys';
	import { isEditableTarget } from '@super-review/ui/utils';
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
	// useAnimations(). Reactive to the setting; defaults to 'accents'.
	setAnimations(() => app.animations);

	// Point `#issue` / `@mention` autolinking (renderMarkdown) at the active
	// repo's GitHub host — the upstream parent for a fork, else its own remote —
	// so rendered comment bodies link references the way GitHub does. Reactive to
	// the repo switch (and to upstream resolution, which updates activeRepo).
	$effect(() => setMarkdownRepoContext(githubHostRepo()));

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
	// Imperative handle on the main (diff) pane. Fullscreen collapses it to zero so
	// the comments panel takes over; the toggle drives this via the $effect below.
	let mainPane = $state<PaneAPI | undefined>();

	// Drive the left sidebar pane from app.sidebarCollapsed. The pane layout is the
	// source of truth (assigning the flag alone won't move it), so drive it
	// imperatively; collapse()/expand() no-op when already in state, and
	// onCollapse/onExpand sync the flag back when the user drags. Mirrors the
	// fullscreen effect below: reacting to the flag (rather than restoring once on
	// mount) lets a repo switch restore each repo's remembered collapse state, not
	// just the launch state. Width drags don't touch the flag, so they never
	// retrigger this. Deferred a frame so PaneForge has committed its layout first.
	$effect(() => {
		const pane = sidebarPane;
		if (!pane) return;
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
		// Open the header repository switcher. The default (Shift+R) has no
		// Cmd/Ctrl/Alt, so skip it while typing in an editable target to avoid
		// hijacking a capital R in the commit/comment composers.
		openRepoPicker: (e) => {
			const hk = app.hotkeys.openRepoPicker;
			if (!hk.mod && !hk.alt && isEditableTarget(e.target)) return;
			e.preventDefault();
			actions.toggleRepoPicker();
		},
		// Open the header branch / pull request picker. Same editable-target guard
		// as the repo picker, and a no-op until a repo is open (the trigger is
		// disabled then anyway).
		openBranchPicker: (e) => {
			const hk = app.hotkeys.openBranchPicker;
			if (!hk.mod && !hk.alt && isEditableTarget(e.target)) return;
			if (!app.activeRepo) return;
			e.preventDefault();
			actions.toggleBranchPicker();
		},
		// Collapse/expand the sidebar by driving the pane handle directly, keeping
		// the layout the single source of truth (onCollapse/onExpand sync back).
		toggleSidebar: (e) => {
			if (!app.activeRepo || !sidebarPane) return;
			e.preventDefault();
			if (app.sidebarCollapsed) sidebarPane.expand();
			else sidebarPane.collapse();
		},
		// Open the right sidebar straight to the Tasks tab (default Cmd/Ctrl+T).
		// Toggles closed when already open on that tab, mirroring the Comments hotkey.
		toggleTasksSidebar: (e) => {
			if (!app.activeRepo) return;
			e.preventDefault();
			actions.openTasksSidebar();
		},
		// Open the comments sidebar straight to the Comments tab (default Cmd/Ctrl+L).
		// Pulls you to Comments from the Conversation tab; toggles closed only when
		// already on the Comments tab.
		toggleCommentsSidebar: (e) => {
			if (!app.activeRepo) return;
			e.preventDefault();
			actions.openCommentsSidebar();
		},
		// Open the comments sidebar straight to the PR Conversation tab (default
		// Cmd/Ctrl+Shift+L). Toggles closed when already open on that tab.
		openConversationSidebar: (e) => {
			if (!app.activeRepo) return;
			e.preventDefault();
			actions.openConversationSidebar();
		},
		// Open the settings dialog from anywhere (default Cmd/Ctrl+Comma).
		openSettings: (e) => {
			e.preventDefault();
			actions.openSettingsDialog();
		},
		// Mark the open file seen and jump to the next change (default
		// Cmd/Ctrl+Enter). Skipped while typing so it doesn't steal the same combo
		// from the commit/comment composers, which use it to submit. Targets the
		// first on-screen *unseen* file rather than `selectedFile`: the latter
		// follows the topmost visible section by position and can sit on an
		// already-seen header pinned at the top, which made the first press merely
		// scroll to the next change instead of marking the one in view.
		markSeenNext: (e) => {
			const target = app.firstVisibleUnseenFile ?? app.selectedFile;
			if (isEditableTarget(e.target) || !target) return;
			e.preventDefault();
			void actions.markSeenAndAdvance(target);
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
	// sidebar. The floor only has to fit the context tabs + the collapse trigger:
	// the seen/total and +/- totals drop out via a container query (see FileList's
	// header) once the sidebar is too narrow for them, so they never force overflow.
	// `SIDEBAR_DEFAULT_PX` opens a fresh layout wide enough to show those totals.
	// Both convert px → a percentage of the measured group width, capped at the pane
	// max. 22/30 are sane fallbacks before the first measure.
	const SIDEBAR_MIN_PX = 330;
	const SIDEBAR_DEFAULT_PX = 450;
	let paneGroupEl = $state<HTMLElement | null>(null);
	let groupWidth = $state(0);
	const sidebarMinSize = $derived(
		groupWidth > 0 ? Math.min(50, (SIDEBAR_MIN_PX / groupWidth) * 100) : 22
	);
	const sidebarDefaultSize = $derived(
		groupWidth > 0 ? Math.min(50, (SIDEBAR_DEFAULT_PX / groupWidth) * 100) : 30
	);

	// Resize handles render as a 1px bg-border line. Hide a handle (transparent +
	// non-interactive) when the pane beside it is collapsed to zero, so a collapsed
	// pane shows no border at all instead of a stray divider at the window edge.
	const VISIBLE_HANDLE = 'transition-colors hover:bg-foreground/20';
	const HIDDEN_HANDLE = 'pointer-events-none bg-transparent';
	// Sidebar↔diff handle: gone when the left sidebar is collapsed (reopen via the
	// TopBar toggle or Cmd+B) and in fullscreen (sidebar is collapsed then too).
	const sidebarHandleClass = $derived(
		app.sidebarCollapsed || app.conversationFullscreen ? HIDDEN_HANDLE : VISIBLE_HANDLE
	);
	// Diff↔comments handle: stays draggable so the conversation can be widened with
	// the sidebar collapsed; only hidden in fullscreen, where the diff is at zero.
	const commentsHandleClass = $derived(app.conversationFullscreen ? HIDDEN_HANDLE : VISIBLE_HANDLE);

	// The comments pane's width range is governed entirely by STATIC pane
	// constraints, never reactive ones: PaneForge reloads (and resets) the whole
	// layout from storage whenever a pane's constraints change, so a reactive
	// maxSize/collapsible would clobber the layout mid-collapse — re-opening the
	// sidebar the instant you closed it. Instead the caps emerge from the diff
	// pane's static minSize: with the sidebar open it holds the comments pane near
	// its old max, and once the sidebar collapses to 0 that freed width lets the
	// comments pane grow much wider. Fullscreen is just the diff pane collapsing to
	// zero, driven imperatively below.

	// Drive the panes from the fullscreen flag. Mirrors the sidebar-restore effect:
	// the flag is the source of truth and we move panes imperatively (collapse/
	// expand no-op when already there). Imperative calls don't touch constraints,
	// so they never trigger the layout reset above. onCollapse/onExpand sync the
	// flag back when the user drags. Entering fullscreen first collapses the left
	// sidebar (so the conversation can fill the area) — done before the diff so the
	// diff's onCollapse already sees the fullscreen flag and doesn't bounce back.
	// Exiting only re-expands the diff; the sidebar stays closed for the user to
	// reopen, matching the manual collapse it stood in for.
	$effect(() => {
		const main = mainPane;
		if (!main) return;
		const sidebar = sidebarPane;
		const fullscreen = app.conversationFullscreen;
		requestAnimationFrame(() => {
			if (fullscreen) {
				sidebar?.collapse();
				main.collapse();
			} else {
				main.expand();
			}
		});
	});

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

	// Same live-watch for the repo's branch tasks, so a task edited in another
	// window (or checked off by an agent via the CLI) shows up without a refresh.
	$effect(() => {
		const repoId = app.activeRepo?.id ?? null;
		void window.api.tasks.watch(repoId);
	});

	// Reload the task list whenever the branch/view it's scoped to changes, so the
	// Tasks tab follows the checked-out branch (or a read-only branch/PR view).
	$effect(() => {
		void taskBranchTarget()?.key;
		if (app.activeRepo) void actions.loadTasks();
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

		// An agent's CLI (or another window) changed this repo's branch tasks on disk
		// — reload the current branch's list if the Tasks tab is showing.
		const offTasksChanged = window.api.events.onTasksChanged((repoId) => {
			void actions.onTasksChanged(repoId);
		});

		// An account's GitHub token started or stopped failing authentication —
		// keep the "sign in again" prompt in sync.
		const offGithubAuthChanged = window.api.events.onGithubAuthChanged((errors) => {
			actions.onGithubAuthChanged(errors);
		});

		// A native "Help" menu item was chosen. "Send Feedback" (also bound to
		// ⇧⌘/ as the item's accelerator) opens the in-app feedback dialog.
		const offHelpMenuAction = window.api.events.onHelpMenuAction((action) => {
			if (action === 'sendFeedback') actions.openFeedbackDialog();
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
			if (document.visibilityState !== 'visible') return;
			// One checks fetch feeds both the header button and the Conversation merge
			// box (shared `prChecks` store), so they never skew.
			void actions.refreshPrChecks();
			// Mergeability is only shown in the Conversation tab — poll it only when
			// that tab is actually visible (gated inside the action).
			actions.pollMergeBox();
		}, CHECKS_POLL_MS);

		return () => {
			offRepoChanged();
			offTrashFailed();
			offSessionsChanged();
			offCommentsChanged();
			offTasksChanged();
			offGithubAuthChanged();
			offHelpMenuAction();
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
				<!-- Stable `id` + `order` are required because the comments pane is
				     conditionally rendered: without them PaneForge re-indexes the group
				     when that pane mounts/unmounts and misfires this pane's
				     onCollapse/onExpand, which is what tied the left/right sidebar
				     toggles together. -->
				<Resizable.Pane
					bind:this={sidebarPane}
					id="sidebar-pane"
					order={1}
					defaultSize={Math.max(sidebarMinSize, sidebarDefaultSize)}
					minSize={sidebarMinSize}
					maxSize={50}
					collapsible
					collapsedSize={0}
					onCollapse={() => actions.setSidebarCollapsed(true)}
					onExpand={() => actions.setSidebarCollapsed(false)}
				>
					<FileList />
				</Resizable.Pane>
				<Resizable.Handle class={sidebarHandleClass} />
				<!-- Statically collapsible (never a reactive constraint — see the layout
				     note above). Its 30% minSize doubles as the comments pane's width
				     cap: with the sidebar open the comments pane can't grow past ~40%,
				     and once the sidebar collapses to 0 that width frees up so it can be
				     dragged much wider. Collapsing the diff to zero IS fullscreen; the
				     fullscreen toggle drives it imperatively and dragging past the min
				     snaps it shut. The diff is only meant to collapse while the sidebar
				     is closed, so onCollapse bounces it back open otherwise. -->
				<Resizable.Pane
					bind:this={mainPane}
					id="main-pane"
					order={2}
					defaultSize={app.commentsSidebarOpen ? 56 : 78}
					collapsible
					collapsedSize={0}
					minSize={30}
					onCollapse={() => {
						// Legit when fullscreen is already engaged (button path: the flag is
						// set before this fires) or when dragging the diff shut with the
						// sidebar already collapsed. Otherwise the diff was dragged shut while
						// the sidebar is open — not allowed, so bounce it back.
						if (app.conversationFullscreen || (app.commentsSidebarOpen && app.sidebarCollapsed)) {
							actions.setConversationFullscreen(true);
						} else {
							requestAnimationFrame(() => mainPane?.expand());
						}
					}}
					onExpand={() => actions.setConversationFullscreen(false)}
				>
					{#if app.contextTab === 'sessions' && !app.activeSessionId}
						<SessionsEmptyState />
					{:else if app.contextTab === 'history' && !app.activeCommit}
						<CommitsEmptyState />
					{:else}
						<DiffView />
					{/if}
				</Resizable.Pane>
				{#if app.commentsSidebarOpen}
					<Resizable.Handle class={commentsHandleClass} />
					<Resizable.Pane id="comments-pane" order={3} defaultSize={22} minSize={15}>
						<CommentsPanel />
					</Resizable.Pane>
				{/if}
			</Resizable.PaneGroup>
		{/if}
	</main>

	<ErrorToasts />
</Sidebar.Provider>

<ConflictDialog />
<ForkDialog />
<RepositorySettingsDialog />
<MergedSwitchDialog />
<MergedRemoveDialog />
<StashPromptDialog />
<StashCollisionDialog />
<SwitchBranchDialog />
<ChangesetDialog />
<ChangesetReviewDialog />
<ConfigureAiDialog />
<BranchMenu />
<RepositoryMenu />
<AddRepoDialog />
<PublishRepoDialog />
<CreateBranchDialog />
<CleanupBranchesDialog />
<SettingsDialog />
<FeedbackDialog />
<GithubSignInDialog />
<CommandPalette />
<ConfirmDeleteDialog />

{#if import.meta.env.DEV}
	<Agentation {...annotationProps} />
{/if}
