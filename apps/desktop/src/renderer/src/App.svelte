<script lang="ts">
  import { onMount } from "svelte";
  import { FolderOpen, FolderSearch, X } from "lucide-svelte";
  import { Badge } from "$lib/components/ui/badge";
  import TopBar from "$lib/components/TopBar.svelte";
  import FileList from "$lib/components/FileList.svelte";
  import DiffView from "$lib/components/DiffView.svelte";
  import SessionsEmptyState from "$lib/components/SessionsEmptyState.svelte";
  import ConflictDialog from "$lib/components/ConflictDialog.svelte";
  import AddRepoDialog from "$lib/components/AddRepoDialog.svelte";
  import CreateBranchDialog from "$lib/components/CreateBranchDialog.svelte";
  import SettingsDialog from "$lib/components/SettingsDialog.svelte";
  import GithubSignInDialog from "$lib/components/GithubSignInDialog.svelte";
  import { ConfirmDeleteDialog } from "$lib/components/ui/confirm-delete-dialog";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import * as Resizable from "$lib/components/ui/resizable";
  import type { PaneAPI } from "paneforge";
  import { actions, setError, app } from "$lib/store.svelte";
  import { initDiffHighlighter } from "$lib/diff-highlighter";
  import { setAnimations } from "$lib/hooks/use-animations.svelte";
  import { matchesHotkey } from "@shared/hotkeys";

  // Share the user's animation preference with the whole component tree so
  // shadcn-svelte primitives can opt in/out of their motion classes via
  // useAnimations(). Off by default; reactive to the setting.
  setAnimations(() => app.animationsEnabled);

  const ORIGIN_POLL_MS = 2 * 60 * 1000;
  const TICK_MS = 30 * 1000;
  const CHECKS_POLL_MS = 20 * 1000;

  // Kick off the shiki highlighter preload early so the very first diff —
  // including the settings preview — has a warm singleton.
  initDiffHighlighter();

  // Imperative handle on the sidebar pane, used by Cmd+B and the
  // SidebarTrigger button to collapse/expand without dragging.
  let sidebarPane = $state<PaneAPI | undefined>();

  // PaneForge sizes panes in percentages, but we want a hard px floor on the
  // sidebar so the combined header (tabs + totals + trigger) never overflows.
  // Measure the group width and convert 450px → a percentage minSize, capped so
  // it can't exceed the pane's max. 22 is a sane fallback before first measure.
  const SIDEBAR_MIN_PX = 450;
  let paneGroupEl = $state<HTMLElement | null>(null);
  let groupWidth = $state(0);
  const sidebarMinSize = $derived(
    groupWidth > 0 ? Math.min(50, (SIDEBAR_MIN_PX / groupWidth) * 100) : 22,
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

    // Refresh the working tree whenever the window regains focus so file
    // changes made externally are reflected without a manual click.
    const onFocus = (): void => {
      if (app.activeRepo) void actions.refresh();
    };
    window.addEventListener("focus", onFocus);

    // The macOS traffic lights are drawn by the OS at a fixed point size, but
    // our header scales with the renderer's zoom factor — so on every zoom
    // change we ask the main process to re-center them. Zoom changes the layout
    // viewport, which fires 'resize'; coalesce with rAF to avoid spamming during
    // live window drags. No-op off macOS.
    let syncQueued = false;
    const syncWindowControls = (): void => {
      if (window.api.platform !== "darwin" || syncQueued) return;
      syncQueued = true;
      requestAnimationFrame(() => {
        syncQueued = false;
        window.api.windowControls.sync();
      });
    };
    window.addEventListener("resize", syncWindowControls);
    syncWindowControls();

    // Configurable sidebar toggle (default Cmd/Ctrl+B). Driving the pane handle
    // directly keeps the layout the single source of truth, same as the trigger
    // buttons; onCollapse/onExpand then sync app.sidebarCollapsed back.
    const onSidebarHotkey = (e: KeyboardEvent): void => {
      if (!matchesHotkey(e, app.hotkeys.toggleSidebar)) return;
      if (!app.activeRepo || !sidebarPane) return;
      e.preventDefault();
      if (app.sidebarCollapsed) sidebarPane.expand();
      else sidebarPane.collapse();
    };
    window.addEventListener("keydown", onSidebarHotkey);

    // Periodically fetch origin so branch base diffs and ahead/behind stay
    // fresh. Only runs while the window is visible to avoid background work
    // on minimized/hidden windows.
    let pollId: number | undefined;
    const startPoll = (): void => {
      if (pollId !== undefined) return;
      pollId = window.setInterval(() => {
        if (app.activeRepo && document.visibilityState === "visible") {
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
      if (document.visibilityState === "visible") startPoll();
      else stopPoll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") startPoll();

    // Drive the "last refreshed Xm ago" label.
    const tickId = window.setInterval(() => actions.tickNow(), TICK_MS);

    // Poll the branch PR's CI/workflow status so the action button's indicator
    // stays current while checks run. Only while visible and a PR is shown.
    const checksId = window.setInterval(() => {
      if (app.branchPR && document.visibilityState === "visible") {
        void actions.refreshBranchPRChecks();
      }
    }, CHECKS_POLL_MS);

    return () => {
      offRepoChanged();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("resize", syncWindowControls);
      window.removeEventListener("keydown", onSidebarHotkey);
      document.removeEventListener("visibilitychange", onVisibility);
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
                <div class="text-xs text-muted-foreground">
                  Open a single git repository.
                </div>
              </div>
            </button>
            <button
              type="button"
              class="relative flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
              onclick={() => actions.openFolder()}
            >
              <Badge variant="secondary" class="absolute right-3 top-3"
                >Recommended</Badge
              >
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
          onCollapse={() => {
            app.sidebarCollapsed = true;
          }}
          onExpand={() => {
            app.sidebarCollapsed = false;
          }}
        >
          <FileList />
        </Resizable.Pane>
        <Resizable.Handle class="hover:bg-foreground/20 transition-colors" />
        <Resizable.Pane defaultSize={78}>
          {#if app.contextTab === "sessions" && !app.activeSessionId}
            <SessionsEmptyState />
          {:else}
            <DiffView />
          {/if}
        </Resizable.Pane>
      </Resizable.PaneGroup>
    {/if}
  </main>

  {#if app.error}
    <div
      role="status"
      class="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive shadow-lg backdrop-blur"
    >
      <span class="flex-1">{app.error}</span>
      <button
        class="rounded p-0.5 hover:bg-destructive/20"
        onclick={() => setError(null)}
        aria-label="Dismiss"
      >
        <X class="size-3.5" />
      </button>
    </div>
  {/if}
</Sidebar.Provider>

<ConflictDialog />
<AddRepoDialog />
<CreateBranchDialog />
<SettingsDialog />
<GithubSignInDialog />
<CommandPalette />
<ConfirmDeleteDialog />
