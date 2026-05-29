<script lang="ts">
  import {
    Check,
    ChevronRight,
    FileMinus,
    FileEdit,
    Folder,
    FolderOpen,
    MessageSquare,
    PanelLeftClose,
    Search,
    X,
  } from 'lucide-svelte';
  import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';
  import { Button } from './ui/button';
  import { Kbd } from './ui/kbd';
  import * as Tabs from './ui/tabs';
  import * as Sidebar from './ui/sidebar';
  import CommitBox from './CommitBox.svelte';
  import { actions, app, type ContextTab } from '$lib/store.svelte';
  import { cn } from '$lib/utils';
  import { languageIconForPath } from '$lib/file-icons';
  import { truncatePathPrefix } from '$lib/path-truncate';
  import { matchesHotkey } from '@shared/hotkeys';
  import type { ChangedFile } from '@shared/types';

  // Right-clicking a file row opens a native OS context menu (built in the main
  // process). preventDefault stops the default browser menu from also showing.
  function onRowContextMenu(e: MouseEvent, file: ChangedFile): void {
    e.preventDefault();
    void actions.showFileContextMenu(file);
  }

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

  // Filter changed files by the shared search query (case-insensitive substring
  // match on the full path). When the query is empty, this is the full list.
  // Lives on the store so the diff view applies the same filter.
  const filteredFiles = $derived.by<ChangedFile[]>(() => {
    const q = app.fileSearchQuery.trim().toLowerCase();
    if (!q) return app.changedFiles;
    return app.changedFiles.filter((f) => f.path.toLowerCase().includes(q));
  });

  // Build the visible flat list of nodes from the changed files. In 'tree'
  // layout, folders are aggregated from the file paths themselves and may be
  // collapsed. In 'list' layout, each file gets its own row at depth 0 with
  // its full path as the display name — no folder rows.
  const nodes = $derived.by<Node[]>(() => {
    if (app.fileListLayout === 'list') {
      const out: Node[] = [];
      for (const f of filteredFiles) {
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

    // While searching, ignore collapsed folders so matches deep in the tree
    // are always visible without forcing the user to expand parents.
    const isSearching = app.fileSearchQuery.trim().length > 0;
    const collapsed = isSearching ? new Set<string>() : app.collapsedFolders;
    const folderCounts = new Map<string, number>();
    for (const f of filteredFiles) {
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

    for (const f of filteredFiles) {
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

  const totals = $derived.by(() => {
    let add = 0,
      del = 0;
    for (const f of app.changedFiles) {
      add += f.additions;
      del += f.deletions;
    }
    return { add, del };
  });

  const seenCount = $derived(
    app.changedFiles.filter((f) => app.seenFiles.has(f.path)).length,
  );

  function pick(path: string): void {
    focusedPath = path;
    actions.scrollToFile(path);
  }

  // Keyboard cursor over the visible flat `nodes` list. Can point at a file OR a
  // folder, independent of `app.selectedFile` (the open file). When
  // `openFileOnArrowNav` is on, moving the cursor onto a file also opens it, so
  // the two usually coincide; in "Enter to open" mode the ring moves freely and
  // Enter/Space commits.
  let focusedPath = $state<string | null>(null);

  // Resolve the cursor's row index, falling back to the open file's row, then
  // the top of the list.
  function currentFocusIndex(): number {
    if (focusedPath) {
      const i = nodes.findIndex((n) => n.path === focusedPath);
      if (i !== -1) return i;
    }
    if (app.selectedFile) {
      const i = nodes.findIndex(
        (n) => n.kind === 'file' && n.path === app.selectedFile,
      );
      if (i !== -1) return i;
    }
    return 0;
  }

  // Move the cursor to a row. Landing on a file opens its diff when
  // `openFileOnArrowNav` is enabled; folders only ever receive the ring.
  function focusNode(index: number): void {
    const node = nodes[index];
    if (!node) return;
    if (node.kind === 'file' && app.openFileOnArrowNav) {
      pick(node.path);
    } else {
      focusedPath = node.path;
    }
  }

  // Move the cursor to the next/previous file (skipping folder rows) starting
  // from `i` and stepping in `dir`. Used by the Option/Alt + Up/Down shortcut.
  function focusFileFrom(i: number, dir: 1 | -1): void {
    for (let j = i + dir; j >= 0 && j < nodes.length; j += dir) {
      if (nodes[j].kind === 'file') {
        focusNode(j);
        return;
      }
    }
  }

  // Arrow-key navigation over the tree. Bound to the scroll region (see the
  // scrollRoot effect) so it only fires when the file list is focused and never
  // steals arrow-scroll from the diff pane.
  function onTreeKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }
    // Leave meta/ctrl combos to app/global shortcuts. Alt is handled below.
    if (e.metaKey || e.ctrlKey) return;
    if (nodes.length === 0) return;

    // Once we know this is a navigation key, pull DOM focus onto the stable
    // scroll container. Row buttons get unmounted by virtualization as they
    // scroll out of view; if focus stayed on one, the keydown would stop
    // bubbling to this handler and arrow keys would fall back to plain
    // scrolling. The container never unmounts, so focus survives navigation.
    const NAV_KEYS = [
      'ArrowDown',
      'ArrowUp',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'Enter',
      ' ',
    ];
    if (!NAV_KEYS.includes(e.key)) return;
    scrollRoot?.focus({ preventScroll: true });

    const i = currentFocusIndex();
    const node = nodes[i];

    // Option/Alt + Up/Down jumps to the next/previous file, skipping folders.
    if (e.altKey) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusFileFrom(i, 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusFileFrom(i, -1);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusNode(Math.min(nodes.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusNode(Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        focusNode(0);
        break;
      case 'End':
        e.preventDefault();
        focusNode(nodes.length - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (node?.kind === 'folder') {
          if (app.collapsedFolders.has(node.path)) {
            actions.toggleFolder(node.path); // expand in place
          } else if (i + 1 < nodes.length) {
            focusNode(i + 1); // step into first child
          }
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (node?.kind === 'folder' && !app.collapsedFolders.has(node.path)) {
          actions.toggleFolder(node.path); // collapse in place
        } else if (node) {
          // Jump to the parent folder row, if one is visible.
          const slash = node.path.lastIndexOf('/');
          const parent = slash >= 0 ? node.path.slice(0, slash) : '';
          if (parent) {
            const p = nodes.findIndex(
              (n) => n.kind === 'folder' && n.path === parent,
            );
            if (p !== -1) focusNode(p);
          }
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (node?.kind === 'folder') {
          actions.toggleFolder(node.path);
        } else if (node?.kind === 'file') {
          pick(node.path);
        }
        break;
    }
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
  // Container width and the CSS font shorthand used by file rows — both feed
  // the pretext-based path truncation in list layout. Tracking width here
  // (rather than per-row) lets us re-use one cache entry per (width, path)
  // across the whole virtualized list.
  let scrollRootWidth = $state(0);
  let rowFont = $state<string>('12px ui-sans-serif, system-ui, sans-serif');

  $effect(() => {
    if (!scrollRoot) return;
    const el = scrollRoot;
    scrollTop = el.scrollTop;
    viewportHeight = el.clientHeight;
    scrollRootWidth = el.clientWidth;
    const cs = window.getComputedStyle(el);
    // text-xs = 12px / 16px in Tailwind. Construct a canvas-compatible font
    // shorthand using the container's inherited font-family.
    rowFont = `${cs.fontWeight} 12px ${cs.fontFamily}`;
    // Make the list a focusable tree region so arrow keys only navigate when
    // the list has focus — elsewhere (e.g. the diff pane) arrows still scroll.
    // Suppress the browser's default focus outline on the container itself; the
    // cursor row carries its own subtle highlight instead.
    el.tabIndex = 0;
    el.setAttribute('role', 'tree');
    el.style.outline = 'none';
    const onScroll = (): void => {
      scrollTop = el.scrollTop;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('keydown', onTreeKeydown);
    const ro = new ResizeObserver(() => {
      viewportHeight = el.clientHeight;
      scrollRootWidth = el.clientWidth;
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('keydown', onTreeKeydown);
      ro.disconnect();
    };
  });

  // Approximate width available for the path text in a list-layout row, after
  // subtracting fixed UI chrome (checkbox, optional file icon, gaps, padding,
  // and a generous reserve for the +/- stats span). One shared value across
  // all rows — slight per-row stats variance is absorbed by the reserve.
  const availablePathWidth = $derived.by(() => {
    const checkbox = 14;
    const icon = app.showFileIcons ? 14 + 6 : 0;
    const statsReserve = 70;
    const gapsAndPadding = 6 + 6 + 8 + 4;
    return Math.max(0, scrollRootWidth - checkbox - icon - statsReserve - gapsAndPadding);
  });

  // Render only the slice of nodes that intersects the viewport (plus a
  // small buffer). Until we've measured the viewport, render a reasonable
  // default window so the first paint isn't empty.
  const visibleRange = $derived.by(() => {
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
  const visibleNodes = $derived(nodes.slice(visibleRange.start, visibleRange.end));
  const topSpacer = $derived(visibleRange.start * ROW_HEIGHT);
  const bottomSpacer = $derived((nodes.length - visibleRange.end) * ROW_HEIGHT);

  // Keep the cursor synced to the open file whenever it changes from outside
  // the tree (clicking a row, "next file" in the diff, etc.) so keyboard
  // navigation resumes from wherever the user last landed.
  $effect(() => {
    const sel = app.selectedFile;
    if (sel) focusedPath = sel;
  });

  // Keep the keyboard cursor visible as it (or the open file) moves. Because
  // the list is virtualized, `scrollIntoView` on the row element won't work
  // (rows outside the visible window aren't mounted) — we set `scrollTop`
  // directly using the known row index × ROW_HEIGHT layout. Reading
  // `scrollRoot.scrollTop` / `.clientHeight` directly (not the reactive
  // mirrors) keeps this effect from re-firing on every scroll tick.
  $effect(() => {
    const path = focusedPath;
    if (!path || !scrollRoot) return;
    const idx = nodes.findIndex((n) => n.path === path);
    if (idx === -1) return;
    const el = scrollRoot;
    const itemTop = idx * ROW_HEIGHT;
    const itemBottom = itemTop + ROW_HEIGHT;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    if (itemTop < viewTop) {
      el.scrollTop = itemTop;
    } else if (itemBottom > viewBottom) {
      el.scrollTop = itemBottom - el.clientHeight;
    }
  });

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const toggleShortcut = isMac ? '⌘B' : 'Ctrl+B';

  // The configurable "search files (sidebar)" shortcut jumps focus to the
  // search input from anywhere in the app. When the binding has no modifier
  // (the default is `/`), it's skipped while the user is typing in an editable
  // target so it doesn't hijack the commit composer, comment composer, or the
  // search input itself. A modifier combo is deliberate and fires anywhere.
  let searchInput = $state<HTMLInputElement | null>(null);
  $effect(() => {
    function onKeydown(e: KeyboardEvent): void {
      const hk = app.hotkeys.searchFilesSidebar;
      if (!matchesHotkey(e, hk)) return;
      if (!hk.mod && !hk.alt) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
      }
      if (!searchInput) return;
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });
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
      {#if app.changedFiles.length > 0}
        <span class="text-xs tabular-nums">
          <span class="font-medium">{seenCount}/{app.changedFiles.length}</span>
        </span>
      {/if}
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
        class="no-scrollbar group-data-horizontal/tabs:h-9 w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent px-1 py-0"
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

    {#if app.contextTab !== 'sessions'}
      <div class="border-b border-border px-2 py-1.5">
        <div
          class="flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2"
        >
          <Search class="size-3 shrink-0 text-muted-foreground" />
          <input
            bind:this={searchInput}
            type="text"
            bind:value={app.fileSearchQuery}
            placeholder="Search files…"
            class="h-full w-full min-w-0 bg-transparent text-xs outline-hidden placeholder:text-muted-foreground"
          />
          {#if app.fileSearchQuery}
            <button
              type="button"
              class="shrink-0 text-muted-foreground hover:text-foreground"
              onclick={() => (app.fileSearchQuery = '')}
              aria-label="Clear search"
            >
              <X class="size-3" />
            </button>
          {:else}
            <Kbd title="Press / to search">/</Kbd>
          {/if}
        </div>
      </div>
    {/if}
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
      {:else if filteredFiles.length === 0}
        <div class="px-3 py-8 text-center text-xs text-muted-foreground">
          No files match "{app.fileSearchQuery}"
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
              {@const isFocused = focusedPath === node.path}
              <button
                type="button"
                role="treeitem"
                aria-expanded={open}
                aria-selected={false}
                class={cn(
                  'flex w-full items-center gap-1 px-2 text-left text-xs text-muted-foreground outline-hidden',
                  isFocused ? 'bg-accent/60' : 'hover:bg-accent/50',
                )}
                style="height: {ROW_HEIGHT}px; padding-left: {node.depth * 12 + 8}px"
                onclick={() => {
                  focusedPath = node.path;
                  actions.toggleFolder(node.path);
                }}
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
              </button>
            {:else}
              {@const isSeen = app.seenFiles.has(node.file.path)}
              {@const iconName = languageIconForPath(node.file.path)}
              {@const isActive = app.selectedFile === node.file.path}
              {@const isFocused = focusedPath === node.file.path}
              {@const threadCount = (app.prComments[node.file.path] ?? []).filter((c) => !c.inReplyTo).length}
              <div
                role="treeitem"
                aria-selected={isActive}
                tabindex={-1}
                class={cn(
                  'group flex w-full items-center gap-1.5 border-l-2 border-transparent pr-2',
                  isActive
                    ? 'border-l-foreground bg-accent'
                    : isFocused
                      ? 'bg-accent/60'
                      : 'hover:bg-accent/50',
                )}
                style="height: {ROW_HEIGHT}px; padding-left: {node.depth * 12 + 4}px"
                oncontextmenu={(e) => onRowContextMenu(e, node.file)}
              >
                <button
                  class={cn(
                    'grid size-3.5 shrink-0 place-items-center rounded border outline-hidden',
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
                  class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-hidden"
                  onclick={() => pick(node.file.path)}
                  type="button"
                >
                  {#if app.showFileIcons}
                    <Icon icon={iconName} class="size-3.5 shrink-0" />
                  {/if}
                  {#if node.dirPrefix !== undefined}
                    {@const displayPrefix = node.dirPrefix
                      ? truncatePathPrefix(node.dirPrefix, node.name, availablePathWidth, rowFont)
                      : ''}
                    <!-- Inline whitespace is intentional: any newline between
                         these flex children becomes a text node inside the
                         flex container, which can render as a visible gap
                         between the truncated prefix and the filename. The
                         prefix string is pre-truncated by pretext to fit
                         `availablePathWidth`, so no CSS text-overflow is
                         needed — that's the whole point of doing this in JS,
                         since text-overflow re-flows every row on every
                         pixel of a sidebar resize. -->
                    <span class={cn('flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap text-xs', isSeen && 'text-muted-foreground line-through')}>{#if displayPrefix}<span class="text-muted-foreground">{displayPrefix}</span>{/if}<span class="shrink-0">{node.name}</span></span>
                  {:else}
                    <span class={cn('truncate text-xs', isSeen && 'text-muted-foreground line-through')}>
                      {node.name}
                    </span>
                  {/if}
                  <span class="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums">
                    {#if threadCount > 0}
                      <span
                        class="flex items-center gap-0.5 text-muted-foreground"
                        title="{threadCount} comment thread{threadCount === 1 ? '' : 's'}"
                      >
                        <MessageSquare class="size-3" />
                        {threadCount}
                      </span>
                    {/if}
                    <span class="flex items-center gap-0.5">
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
