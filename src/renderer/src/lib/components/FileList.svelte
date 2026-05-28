<script lang="ts">
  import {
    Check,
    ChevronRight,
    FileMinus,
    FileEdit,
    Folder,
    FolderOpen,
    PanelLeftClose,
  } from 'lucide-svelte';
  import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';
  import { Button } from './ui/button';
  import * as Tabs from './ui/tabs';
  import * as Sidebar from './ui/sidebar';
  import CommitBox from './CommitBox.svelte';
  import { actions, app, type ContextTab } from '$lib/store.svelte';
  import { cn } from '$lib/utils';
  import { languageIconForPath } from '$lib/file-icons';
  import type { ChangedFile } from '@shared/types';

  type Node =
    | { kind: 'folder'; path: string; name: string; depth: number; childCount: number }
    | {
        kind: 'file';
        path: string;
        name: string;
        // GitHub-style muted directory prefix shown before `name`. Only set in
        // 'list' layout, where the whole path is shown on a single row.
        dirPrefix?: string;
        depth: number;
        file: ChangedFile;
      };

  // Tight, uniform row height for the virtualizer. Each row enforces this
  // with `style="height: ${ROW_HEIGHT}px"` + `items-center` so the math
  // (start/end index from scrollTop) stays exact regardless of content.
  const ROW_HEIGHT = 22;
  // Off-screen rows kept mounted on either side of the viewport so a quick
  // wheel flick or arrow scroll doesn't reveal blank rows before the next
  // animation frame fills them in.
  const BUFFER_ROWS = 8;

  // Build the visible flat list of nodes from the changed files. In 'tree'
  // layout, folders are aggregated from the file paths themselves and may be
  // collapsed. In 'list' layout, each file gets its own row at depth 0 with
  // its full path as the display name — no folder rows.
  let nodes = $derived.by<Node[]>(() => {
    if (app.fileListLayout === 'list') {
      const out: Node[] = [];
      for (const f of app.changedFiles) {
        const slash = f.path.lastIndexOf('/');
        // Fold the path separator into the filename (`/CreateBranchDialog.svelte`)
        // so the row only needs two flex children — a truncating prefix and a
        // shrink-0 filename. With three children (prefix + slash span + name),
        // when the truncate span shrinks small enough, Chromium's text-overflow
        // can leave a few subpixels of empty space between the ellipsis and
        // the next flex item, which read as a visible gap.
        const dirPrefix = slash >= 0 ? f.path.slice(0, slash) : '';
        const name = slash >= 0 ? f.path.slice(slash) : f.path;
        out.push({
          kind: 'file',
          path: f.path,
          name,
          dirPrefix,
          depth: 0,
          file: f,
        });
      }
      return out;
    }

    const collapsed = app.collapsedFolders;
    const folderCounts = new Map<string, number>();
    for (const f of app.changedFiles) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        folderCounts.set(dir, (folderCounts.get(dir) ?? 0) + 1);
      }
    }

    // The store sorts app.changedFiles VSCode-style (folders before files at
    // each level), so iterating in order yields the correct tree layout.
    const out: Node[] = [];
    const seenFolders = new Set<string>();
    let skipPrefix: string | null = null;

    for (const f of app.changedFiles) {
      const parts = f.path.split('/');
      const dirs = parts.slice(0, -1);
      const name = parts[parts.length - 1];

      if (skipPrefix && f.path.startsWith(skipPrefix + '/')) continue;
      skipPrefix = null;

      for (let i = 0; i < dirs.length; i++) {
        const dirPath = parts.slice(0, i + 1).join('/');
        if (seenFolders.has(dirPath)) continue;
        seenFolders.add(dirPath);
        out.push({
          kind: 'folder',
          path: dirPath,
          name: dirs[i],
          depth: i,
          childCount: folderCounts.get(dirPath) ?? 0,
        });
        if (collapsed.has(dirPath)) {
          skipPrefix = dirPath;
          break;
        }
      }
      if (skipPrefix) continue;

      out.push({
        kind: 'file',
        path: f.path,
        name,
        depth: dirs.length,
        file: f,
      });
    }
    return out;
  });

  let totals = $derived.by(() => {
    let add = 0,
      del = 0;
    for (const f of app.changedFiles) {
      add += f.additions;
      del += f.deletions;
    }
    return { add, del };
  });

  let seenCount = $derived(
    app.changedFiles.filter((f) => app.seenFiles.has(f.path)).length,
  );

  function pick(path: string): void {
    actions.scrollToFile(path);
  }

  function toggleSeen(e: MouseEvent, f: ChangedFile): void {
    e.stopPropagation();
    void actions.toggleSeen(f.path);
  }

  function setTab(v: string): void {
    void actions.setContextTab(v as ContextTab);
  }

  // Virtualizer state — wired up to the Sidebar.Content scroll container
  // through its `ref` prop. We re-measure on scroll (for scrollTop) and on
  // resize (for clientHeight — pane drags, window resize, sidebar collapse).
  let scrollRoot = $state<HTMLElement | null>(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);

  $effect(() => {
    if (!scrollRoot) return;
    const el = scrollRoot;
    scrollTop = el.scrollTop;
    viewportHeight = el.clientHeight;
    const onScroll = (): void => {
      scrollTop = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      viewportHeight = el.clientHeight;
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  });

  // Render only the slice of nodes that intersects the viewport (plus a
  // small buffer). Until we've measured the viewport, render a reasonable
  // default window so the first paint isn't empty.
  let visibleRange = $derived.by(() => {
    if (nodes.length === 0) return { start: 0, end: 0 };
    if (viewportHeight === 0) {
      return { start: 0, end: Math.min(nodes.length, 60) };
    }
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const end = Math.min(
      nodes.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS,
    );
    return { start, end };
  });
  let visibleNodes = $derived(nodes.slice(visibleRange.start, visibleRange.end));
  let topSpacer = $derived(visibleRange.start * ROW_HEIGHT);
  let bottomSpacer = $derived((nodes.length - visibleRange.end) * ROW_HEIGHT);

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const toggleShortcut = isMac ? '⌘B' : 'Ctrl+B';
</script>

<!--
  Width is controlled by the surrounding Resizable.Pane. collapsible="none"
  keeps Sidebar.Root from imposing its own fixed-position layout. The pane
  collapses to 0 width on Cmd+B or drag, which unmounts this visually — so
  we no longer need an in-list "expand from collapsed" branch.
-->
<Sidebar.Root collapsible="none" class="h-full w-full border-r border-sidebar-border bg-card/30">
  <Sidebar.Header class="gap-0 p-0">
    <!-- Progress strip — seen/total, +adds, -dels, collapse. -->
    <div class="flex items-center gap-2 border-b border-border px-2 py-1.5">
      <span class="text-xs tabular-nums">
        <span class="font-medium">{seenCount}/{app.changedFiles.length}</span>
      </span>
      {#if app.changedFiles.length > 0 && (totals.add > 0 || totals.del > 0)}
        <span class="text-[11px] tabular-nums">
          {#if totals.add > 0}
            <span class="text-success">+{totals.add}</span>
          {/if}
          {#if totals.del > 0}
            <span class="ml-0.5 text-destructive">−{totals.del}</span>
          {/if}
        </span>
      {/if}
      <span class="flex-1"></span>
      <Button
        variant="ghost"
        size="icon-xs"
        title={`Collapse sidebar (${toggleShortcut})`}
        onclick={() => actions.toggleSidebar()}
      >
        <PanelLeftClose class="size-3.5" />
      </Button>
    </div>

    <!-- Tab strip: drives which diff context fuels the file list. -->
    <Tabs.Root value={app.contextTab} onValueChange={setTab} class="gap-0">
      <Tabs.List
        class="group-data-horizontal/tabs:h-9 w-full justify-start gap-1 rounded-none border-b border-border bg-transparent px-1 py-0"
      >
        <Tabs.Trigger
          value="unstaged"
          class="h-7 flex-none gap-1.5 rounded-md border-0 px-3 py-1.5 text-xs shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none dark:data-active:border-0 dark:data-active:bg-muted"
        >
          Unstaged
          {#if app.unstagedFileCount > 0}
            <span
              class="grid h-4 min-w-4 place-items-center rounded-full bg-foreground/10 px-1 text-[10px] font-medium tabular-nums leading-none text-foreground"
            >
              {app.unstagedFileCount > 99 ? '99+' : app.unstagedFileCount}
            </span>
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger
          value="branch"
          class="h-7 flex-none rounded-md border-0 px-3 py-1.5 text-xs shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none dark:data-active:border-0 dark:data-active:bg-muted"
        >
          Branch
        </Tabs.Trigger>
        <Tabs.Trigger
          value="sessions"
          class="h-7 flex-none rounded-md border-0 px-3 py-1.5 text-xs shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none dark:data-active:border-0 dark:data-active:bg-muted"
        >
          Sessions
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
  </Sidebar.Header>

  <Sidebar.Content bind:ref={scrollRoot}>
      {#if app.contextTab === 'sessions'}
        <div class="px-3 py-8 text-center text-xs text-muted-foreground">
          Agent sessions are coming soon.
        </div>
      {:else if app.loading.files && app.changedFiles.length === 0}
        <div class="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
      {:else if app.changedFiles.length === 0}
        <div class="px-3 py-8 text-center text-xs text-muted-foreground">
          {#if app.contextTab === 'branch'}
            No changes on this branch
          {:else}
            No changes
          {/if}
        </div>
      {:else}
        <!--
          Virtualized window: only the slice intersecting the viewport (plus
          BUFFER_ROWS on either side) is mounted. The padding spacers reserve
          the scrollable area so the scrollbar reflects total length and
          scrollTop math keeps tracking the true list position.
        -->
        <div style="padding-top: {topSpacer}px; padding-bottom: {bottomSpacer}px;">
          {#each visibleNodes as node (node.kind + ':' + node.path)}
            {#if node.kind === 'folder'}
              {@const open = !app.collapsedFolders.has(node.path)}
              <button
                type="button"
                class="flex w-full items-center gap-1 px-2 text-left text-xs text-muted-foreground hover:bg-accent/50"
                style="height: {ROW_HEIGHT}px; padding-left: {node.depth * 12 + 8}px"
                onclick={() => actions.toggleFolder(node.path)}
              >
                <ChevronRight
                  class={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
                />
                {#if open}
                  <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
                {:else}
                  <Folder class="size-3.5 shrink-0 text-muted-foreground" />
                {/if}
                <span class="truncate">{node.name}</span>
                <span class="ml-auto pr-1 text-[10px] tabular-nums">{node.childCount}</span>
              </button>
            {:else}
              {@const isSeen = app.seenFiles.has(node.file.path)}
              {@const iconName = languageIconForPath(node.file.path)}
              {@const isActive = app.selectedFile === node.file.path}
              <div
                class={cn(
                  'group flex w-full items-center gap-1.5 border-l-2 border-transparent pr-2',
                  isActive ? 'border-l-foreground bg-accent' : 'hover:bg-accent/50',
                  isSeen && 'opacity-50',
                )}
                style="height: {ROW_HEIGHT}px; padding-left: {node.depth * 12 + 4}px"
              >
                <button
                  class={cn(
                    'grid size-3.5 shrink-0 place-items-center rounded border',
                    isSeen
                      ? 'border-success bg-success text-success-foreground'
                      : 'border-border hover:border-foreground',
                  )}
                  onclick={(e) => toggleSeen(e, node.file)}
                  aria-label={isSeen ? 'Mark unseen' : 'Mark seen'}
                  type="button"
                >
                  {#if isSeen}
                    <Check class="size-2.5" />
                  {/if}
                </button>
                <button
                  class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
                  onclick={() => pick(node.file.path)}
                  type="button"
                >
                  {#if app.showFileIcons}
                    <Icon icon={iconName} class="size-3.5 shrink-0" />
                  {/if}
                  {#if node.dirPrefix !== undefined}
                    <!-- Inline whitespace is intentional: any newline between
                         these flex children becomes a text node inside the
                         flex container, which can render as a visible gap
                         between the truncated prefix and the filename. -->
                    <span class={cn('flex min-w-0 flex-1 items-center text-xs', isSeen && 'line-through')}>{#if node.dirPrefix}<span class="min-w-0 truncate text-muted-foreground">{node.dirPrefix}</span>{/if}<span class="shrink-0">{node.name}</span></span>
                  {:else}
                    <span class={cn('truncate text-xs', isSeen && 'line-through')}>
                      {node.name}
                    </span>
                  {/if}
                  <span class="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums">
                    {#if node.file.status === 'deleted'}
                      <FileMinus class="size-3 text-destructive" />
                    {:else if node.file.status === 'renamed' || node.file.status === 'copied'}
                      <FileEdit class="size-3 text-warning" />
                    {:else if node.file.isBinary}
                      <span class="text-muted-foreground">bin</span>
                    {:else}
                      {#if node.file.additions > 0}
                        <span class="text-success">+{node.file.additions}</span>
                      {/if}
                      {#if node.file.deletions > 0}
                        <span class="text-destructive">−{node.file.deletions}</span>
                      {/if}
                    {/if}
                  </span>
                </button>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
  </Sidebar.Content>

  {#if app.contextTab === 'unstaged'}
    <Sidebar.Footer class="gap-0 p-0">
      <CommitBox />
    </Sidebar.Footer>
  {/if}
</Sidebar.Root>
