<script lang="ts">
  import { mount, unmount, onDestroy } from 'svelte';
  import { Check, ChevronDown, ChevronRight, Eye } from 'lucide-svelte';
  import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';
  import { languageIconForPath } from '$lib/file-icons';
  import {
    DIFFS_TAG_NAME,
    FileDiff as FileDiffClass,
    parseDiffFromFile,
    type DiffLineAnnotation,
    type OnDiffLineClickProps,
    type SelectedLineRange,
  } from '@pierre/diffs';
  import { Button } from './ui/button';
  import { Badge } from './ui/badge';
  import { actions, app, composerKey, getCachedDiff, setCachedDiff } from '$lib/store.svelte';
  import { scheduleRender } from '$lib/render-scheduler';
  import { diffContextKey } from '@shared/diff-context';
  import CommentAnnotation, { type CommentMeta } from './CommentAnnotation.svelte';
  import type { ChangedFile, DiffContext, DiffData, PRReviewComment } from '@shared/types';

  interface Props {
    file: ChangedFile;
    observer: IntersectionObserver | null;
  }

  let { file, observer }: Props = $props();

  let section = $state<HTMLElement | null>(null);
  let host = $state<HTMLElement | null>(null);
  let diffContainer: HTMLElement | null = null;
  let instance: FileDiffClass<CommentMeta> | null = null;
  // Cache of mounted CommentAnnotation instances, keyed by annotation index.
  // FileDiff caches its wrapper element per annotation; we mount our component
  // once and let its $derived expressions react to store changes.
  const mountedComponents = new Map<string, ReturnType<typeof mount>>();
  let diffData = $state<DiffData | null>(null);
  // Context key the current `diffData` was loaded for. When the user switches
  // tabs and the {#each} reuses this component (because the file exists in
  // both contexts), this lets us detect the stale render and refetch.
  let loadedCtxKey = $state<string | null>(null);
  // Bumped every time `diffData` is replaced so the render effect notices new
  // content even when the context key stays the same (e.g. cached → fresh).
  let dataEpoch = $state(0);
  // `${ctxKey}::${viewMode}::${epoch}` of what's currently in the DOM. Diverges
  // from `targetRenderKey` whenever a render is pending or needed.
  let renderedKey = $state<string | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let inView = $state(false);
  let expanded = $derived(!app.collapsedFiles.has(file.path));
  // Handle for the most recently queued render so we can cancel it if a newer
  // target supersedes it before the scheduler gets to it.
  let cancelPendingRender: (() => void) | null = null;

  // Show comments / accept new ones only where the local diff matches what
  // GitHub thinks the PR contains:
  //   - `kind: 'pr'`: reviewing someone's PR (refs `pr/N/base...pr/N/head`).
  //   - Branch tab with an open PR for the current branch (base...head).
  // The Unstaged tab is intentionally excluded — its line numbers reflect
  // uncommitted changes and don't translate to anything on GitHub.
  let isPRContext = $derived(
    app.diffContext.kind === 'pr' ||
      (app.contextTab === 'branch' && app.branchPR != null),
  );

  // Build the annotation list FileDiff renders: every existing comment +
  // any pending composers on this file. Annotation order matters for the
  // cache key — `${index}-${side}-${line}` — but as long as we deterministically
  // append composers after comments we get stable identities across updates.
  let lineAnnotations = $derived.by<DiffLineAnnotation<CommentMeta>[]>(() => {
    if (!isPRContext) return [];
    const out: DiffLineAnnotation<CommentMeta>[] = [];
    const comments = app.prComments[file.path] ?? [];
    for (const c of comments) {
      if (c.line == null) continue;
      out.push({
        side: c.side === 'LEFT' ? 'deletions' : 'additions',
        lineNumber: c.line,
        metadata: { kind: 'comment', comment: c },
      });
    }
    for (const composer of Object.values(app.pendingComposers)) {
      if (composer.filePath !== file.path) continue;
      out.push({
        side: composer.side === 'LEFT' ? 'deletions' : 'additions',
        lineNumber: composer.line,
        metadata: {
          kind: 'composer',
          filePath: composer.filePath,
          line: composer.line,
          side: composer.side,
          replyTo: composer.replyTo,
        },
      });
    }
    return out;
  });

  // Register the section with the parent's IntersectionObserver. The observer
  // flips `data-in-view` on the section element when it (or its margin region)
  // intersects the scroll container — see DiffView.svelte for the callback.
  $effect(() => {
    if (!section || !observer) return;
    const node = section;
    const obs = observer;
    obs.observe(node);
    return () => obs.unobserve(node);
  });

  function markInView(v: boolean): void {
    inView = v;
  }
  $effect(() => {
    if (!section) return;
    (section as HTMLElement & { __setInView?: (v: boolean) => void }).__setInView = markInView;
  });

  function unmountAll(): void {
    for (const cmp of mountedComponents.values()) {
      try {
        unmount(cmp);
      } catch {
        // ignore
      }
    }
    mountedComponents.clear();
  }

  function disposeDiff(): void {
    unmountAll();
    if (instance) {
      try {
        instance.cleanUp();
      } catch {
        // ignore
      }
      instance = null;
    }
    if (diffContainer) {
      diffContainer.remove();
      diffContainer = null;
    }
  }

  function annotationCacheKey(a: DiffLineAnnotation<CommentMeta>, index: number): string {
    return `${index}-${a.side}-${a.lineNumber}`;
  }

  function renderAnnotation(
    annotation: DiffLineAnnotation<CommentMeta>,
  ): HTMLElement | undefined {
    // eslint-disable-next-line no-console
    console.log('[PR comment] renderAnnotation called', {
      file: file.path,
      side: annotation.side,
      lineNumber: annotation.lineNumber,
      metaKind: annotation.metadata?.kind,
    });
    if (!annotation.metadata) return undefined;
    const container = document.createElement('div');
    // Stamp the same cache key Pierre uses so we can unmount the matching
    // component when the annotation list changes. The current index isn't
    // available here — we read it from the annotations array below.
    const idx = lineAnnotations.indexOf(annotation);
    if (idx >= 0) {
      const key = annotationCacheKey(annotation, idx);
      const existing = mountedComponents.get(key);
      if (existing) {
        try {
          unmount(existing);
        } catch {
          // ignore
        }
      }
      const cmp = mount(CommentAnnotation, {
        target: container,
        props: { meta: annotation.metadata },
      });
      mountedComponents.set(key, cmp);
    }
    return container;
  }

  function onDiffLineNumberClick(props: OnDiffLineClickProps): void {
    // eslint-disable-next-line no-console
    console.log('[PR comment] line-number click', {
      isPRContext,
      contextTab: app.contextTab,
      diffKind: app.diffContext.kind,
      branchPR: app.branchPR?.number ?? null,
      file: file.path,
      lineNumber: props.lineNumber,
      annotationSide: props.annotationSide,
    });
    if (!isPRContext) return;
    const side = props.annotationSide === 'deletions' ? 'LEFT' : 'RIGHT';
    actions.openComposer(file.path, side, props.lineNumber);
  }

  // Pierre's idiomatic gutter affordance: `enableGutterUtility: true` paints
  // their built-in `+` button on hover, and `onGutterUtilityClick` delivers
  // the selected line range when it's clicked. No custom DOM, no event
  // wrestling — Pierre owns the whole interaction.
  function onGutterClick(range: SelectedLineRange): void {
    // eslint-disable-next-line no-console
    console.log('[PR comment] gutter click', {
      isPRContext,
      contextTab: app.contextTab,
      diffKind: app.diffContext.kind,
      branchPR: app.branchPR?.number ?? null,
      file: file.path,
      range,
    });
    if (!isPRContext) return;
    const sel = range.side ?? 'additions';
    const side = sel === 'deletions' ? 'LEFT' : 'RIGHT';
    // For a plain click `start === end`. Drag-select reports both ends; we
    // attach the comment to the first (top) line for now.
    actions.openComposer(file.path, side, range.start);
  }

  function renderDiff(diff: DiffData): void {
    if (!host) return;
    disposeDiff();
    if (diff.file.isBinary) return;

    diffContainer = document.createElement(DIFFS_TAG_NAME);
    host.appendChild(diffContainer);
    instance = new FileDiffClass<CommentMeta>({
      diffStyle: app.viewMode,
      themeType: app.theme,
      disableFileHeader: true,
      renderAnnotation,
      onLineNumberClick: onDiffLineNumberClick,
      // Built-in gutter `+` button (the one with `data-utility-button`).
      // Only enable it where commenting is meaningful — toggled live below
      // via setOptions + flushManagers when `isPRContext` changes.
      enableGutterUtility: isPRContext,
      onGutterUtilityClick: onGutterClick,
    });

    const namePair = {
      old: diff.file.oldPath ?? diff.file.path,
      new: diff.file.path,
    };
    const oldFile = { name: namePair.old, contents: diff.oldContents };
    const newFile = { name: namePair.new, contents: diff.newContents };

    let metadata;
    try {
      metadata = parseDiffFromFile(oldFile, newFile);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      return;
    }
    if (!metadata) return;

    try {
      instance.render({
        fileContainer: diffContainer,
        fileDiff: metadata,
        oldFile,
        newFile,
        lineAnnotations,
      });
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  // What the DOM *should* reflect given the currently loaded data + UI mode.
  // Compared against `renderedKey` to decide whether a (re)render is needed.
  let targetRenderKey = $derived(
    loadedCtxKey && diffData ? `${loadedCtxKey}::${app.viewMode}::${dataEpoch}` : null,
  );

  // True when there's no DOM in the host yet for the current data — the
  // placeholder uses this to keep "Loading diff…" visible across the gap
  // between data landing and the scheduler actually running renderDiff.
  let isAwaitingFirstRender = $derived(
    targetRenderKey !== null && renderedKey === null,
  );

  function setLoadedDiff(d: DiffData, ctxKey: string): void {
    diffData = d;
    loadedCtxKey = ctxKey;
    dataEpoch++;
  }

  function clearLoadedDiff(): void {
    diffData = null;
    loadedCtxKey = null;
    cancelPendingRender?.();
    cancelPendingRender = null;
    disposeDiff();
    renderedKey = null;
  }

  // Hand the actual DOM work to the global render scheduler so the UI can
  // paint state changes (tab switch, dialog close) before this section
  // synchronously rebuilds its diff. The scheduler time-budgets the queue
  // across animation frames; even a viewMode flip that invalidates every
  // visible section stays under the per-frame budget.
  function queueRender(data: DiffData, target: string): void {
    cancelPendingRender?.();
    cancelPendingRender = scheduleRender(() => {
      cancelPendingRender = null;
      renderDiff(data);
      renderedKey = target;
    });
  }

  // Fetch the diff the first time the section enters view (and stays expanded).
  // Hydrates from the cross-tab diff cache when available so switching back
  // to a context renders instantly, then refreshes in the background. The
  // actual DOM render is kicked off by the render effect below.
  $effect(() => {
    if (!inView || !expanded || !app.activeRepo) return;
    const repo = app.activeRepo;
    const ctx = $state.snapshot(app.diffContext) as DiffContext;
    const ctxKey = diffContextKey(ctx);
    // Already up to date for this context, or a fetch is in flight.
    if (diffData && loadedCtxKey === ctxKey) return;
    if (loading) return;

    const cached = getCachedDiff(repo.id, ctx, file.path);
    // Always drop stale DOM/render state when the context changed — the cached
    // hit (if any) belongs to a different context's data, so showing it would
    // be misleading.
    if (loadedCtxKey && loadedCtxKey !== ctxKey) clearLoadedDiff();

    if (cached) {
      setLoadedDiff(cached, ctxKey);
      loadError = null;
    } else {
      loading = true;
      loadError = null;
    }

    void window.api.git
      .getDiff(repo.id, file.path, ctx)
      .then((d) => {
        setCachedDiff(repo.id, ctx, file.path, d);
        // Bail if the user moved on while we were fetching.
        if (!app.activeRepo || app.activeRepo.id !== repo.id) return;
        const currentKey = diffContextKey($state.snapshot(app.diffContext) as DiffContext);
        if (currentKey !== ctxKey) return;
        // Skip the re-render when cached content matched what came back.
        if (
          cached &&
          cached.oldContents === d.oldContents &&
          cached.newContents === d.newContents &&
          cached.patch === d.patch
        ) {
          return;
        }
        setLoadedDiff(d, ctxKey);
      })
      .catch((err) => {
        if (!cached) loadError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        loading = false;
      });
  });

  // Render effect — runs whenever the target diverges from what's in the DOM.
  // Visible sections queue through the scheduler; off-screen ones drop their
  // stale DOM and wait for the next scroll-into-view tick. That keeps the
  // queue short on viewMode flips so the visible diffs render fast instead
  // of being stuck behind hundreds of off-screen re-renders.
  $effect(() => {
    const target = targetRenderKey;
    if (target === null) return;
    if (renderedKey === target) return;
    if (!inView) {
      if (renderedKey !== null) {
        cancelPendingRender?.();
        cancelPendingRender = null;
        disposeDiff();
        renderedKey = null;
      }
      return;
    }
    queueRender(diffData!, target);
  });

  // Push new annotations into the live FileDiff instance. `setLineAnnotations`
  // alone only updates Pierre's internal pointer — `rerender` is what actually
  // walks the annotation cache and paints new entries. The cache key is
  // `${index}-${side}-${lineNumber}`, so existing comment DOM survives and
  // only newly-keyed annotations trigger a `renderAnnotation` call.
  //
  // IMPORTANT: read `lineAnnotations` *first* so Svelte registers it as a
  // dependency even on the early-mount pass when `instance` is still null.
  // `instance` is a plain `let` (not `$state`), so it doesn't trigger
  // re-runs on assignment — without reading the derived up-front, this
  // effect would never re-fire when the user adds a composer.
  $effect(() => {
    const annotations = lineAnnotations;
    if (!instance) return;
    // eslint-disable-next-line no-console
    console.log('[PR comment] annotations effect — before', {
      file: file.path,
      count: annotations.length,
      kinds: annotations.map((a) => a.metadata?.kind ?? '?'),
      lines: annotations.map((a) => `${a.side}:${a.lineNumber}`),
    });
    // Drop cached mounted components that no longer have a matching index.
    const liveKeys = new Set(annotations.map((a, i) => annotationCacheKey(a, i)));
    for (const key of [...mountedComponents.keys()]) {
      if (!liveKeys.has(key)) {
        const cmp = mountedComponents.get(key);
        if (cmp) {
          try {
            unmount(cmp);
          } catch {
            // ignore
          }
        }
        mountedComponents.delete(key);
      }
    }
    try {
      instance.setLineAnnotations(annotations);
      instance.rerender();
      // eslint-disable-next-line no-console
      console.log('[PR comment] annotations effect — after rerender ok', {
        file: file.path,
        mountedCount: mountedComponents.size,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PR comment] rerender failed', err);
    }
  });

  // Toggle Pierre's built-in gutter `+` button live as the user switches
  // between commentable / non-commentable contexts. `setOptions` swaps the
  // option bag, `flushManagers` reruns `InteractionManager.setup`, which is
  // the path that adds (or removes) the gutter container.
  // Same caveat as the annotations effect: read `isPRContext` first so the
  // dependency is registered even when `instance` is null on first run.
  $effect(() => {
    const enabled = isPRContext;
    if (!instance) return;
    type WithOptions = { options: Record<string, unknown> };
    const current = (instance as unknown as WithOptions).options;
    if (current.enableGutterUtility === enabled) return;
    instance.setOptions({ ...current, enableGutterUtility: enabled } as Parameters<
      typeof instance.setOptions
    >[0]);
    try {
      instance.flushManagers();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PR comment] flushManagers failed', err);
    }
  });

  // Live-swap the diff theme when the app theme changes. `setThemeType` alone
  // only swaps the cached CSS overlay; the highlighter's token cache still
  // holds the previous theme's colors. `onThemeChange` clears that cache and
  // triggers a fresh render that picks up the new themeType.
  //
  // IMPORTANT: read `app.theme` *first* so Svelte registers it as a
  // dependency even on the early-mount pass when `instance` is still null.
  // `instance` is a plain `let` (not `$state`) so assigning it later doesn't
  // wake this effect — without reading the reactive value up-front, the
  // effect would orphan and never re-fire on theme changes.
  $effect(() => {
    const t = app.theme;
    if (!instance) return;
    try {
      instance.setThemeType(t);
      instance.onThemeChange();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[theme] diff theme change failed', err);
    }
  });

  onDestroy(() => {
    cancelPendingRender?.();
    cancelPendingRender = null;
    disposeDiff();
  });

  let isSeen = $derived(app.seenFiles.has(file.path));
  let commentCount = $derived(
    isPRContext ? (app.prComments[file.path] ?? []).length : 0,
  );
  let statusBadge = $derived.by(() => {
    switch (file.status) {
      case 'deleted':
        return 'deleted';
      case 'renamed':
        return 'renamed';
      default:
        return null;
    }
  });

  // "Mark seen" doubles as a "next file" affordance: collapse this section
  // so the next file's header slides up under the cursor, then trigger the
  // existing scroll machinery to pin it at the top. Un-marking is a passive
  // edit — leave layout alone.
  function handleMarkSeen(): void {
    const wasSeen = app.seenFiles.has(file.path);
    void actions.toggleSeen(file.path);
    if (wasSeen) return;
    void actions.toggleFileCollapsed(file.path, true);
    const idx = app.changedFiles.findIndex((f) => f.path === file.path);
    const next = idx >= 0 ? app.changedFiles[idx + 1] : undefined;
    if (next) actions.scrollToFile(next.path);
  }
  // Surface comments that fall outside the rendered diff (e.g. on lines we
  // skipped) so they aren't silently lost.
  let orphanComments = $derived.by<PRReviewComment[]>(() => {
    if (!isPRContext) return [];
    return (app.prComments[file.path] ?? []).filter((c) => c.line == null);
  });
</script>

<section
  bind:this={section}
  data-file-path={file.path}
  class="border-b border-border"
>
  <header
    class={[
      'sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur',
      isSeen && 'opacity-60',
    ]}
  >
    <button
      type="button"
      class="grid size-5 shrink-0 place-items-center rounded hover:bg-accent"
      onclick={() => actions.toggleFileCollapsed(file.path)}
      aria-label={expanded ? 'Collapse' : 'Expand'}
    >
      {#if expanded}
        <ChevronDown class="size-3.5" />
      {:else}
        <ChevronRight class="size-3.5" />
      {/if}
    </button>
    <Icon icon={languageIconForPath(file.path)} class="size-3.5 shrink-0" />
    <span class="truncate font-mono text-xs" title={file.path}>{file.path}</span>
    {#if statusBadge}
      <Badge variant={statusBadge === 'added' ? 'success' : statusBadge === 'deleted' ? 'destructive' : 'warning'}>
        {statusBadge}
      </Badge>
    {/if}
    {#if file.isBinary}
      <Badge variant="muted">binary</Badge>
    {/if}
    {#if isPRContext && commentCount > 0}
      <Badge variant="muted">{commentCount} comment{commentCount === 1 ? '' : 's'}</Badge>
    {/if}
    <div class="ml-auto flex items-center gap-2 text-[10px] tabular-nums">
      {#if !file.isBinary}
        {#if file.additions > 0}
          <span class="text-success">+{file.additions}</span>
        {/if}
        {#if file.deletions > 0}
          <span class="text-destructive">−{file.deletions}</span>
        {/if}
      {/if}
      <Button
        variant={isSeen ? 'secondary' : 'outline'}
        size="sm"
        onclick={handleMarkSeen}
      >
        {#if isSeen}
          <Check class="size-3.5" /> Seen
        {:else}
          <Eye class="size-3.5" /> Mark seen
        {/if}
      </Button>
    </div>
  </header>

  <div class="bg-card/20" hidden={!expanded}>
    {#if loadError}
      <div class="p-4 text-sm text-destructive">{loadError}</div>
    {:else if (loading || isAwaitingFirstRender) && !diffData?.file.isBinary}
      <div class="p-4 text-xs text-muted-foreground">Loading diff…</div>
    {:else if !inView && !diffData}
      <div
        class="grid place-items-center text-xs text-muted-foreground"
        style="min-height: {Math.min(400, (file.additions + file.deletions) * 18 + 48)}px"
      >
        <span class="opacity-50">Scroll to load</span>
      </div>
    {:else if diffData?.file.isBinary}
      <div class="p-4 text-sm text-muted-foreground">Binary file — diff not shown.</div>
    {:else if diffData?.truncated}
      <div class="p-4 text-sm text-muted-foreground">
        File too large to render. Diff preview disabled.
      </div>
    {/if}
    <div bind:this={host} class="diff-host"></div>
    {#if orphanComments.length > 0}
      <div class="border-t border-border p-3 text-xs text-muted-foreground">
        <p class="mb-2 font-medium">
          {orphanComments.length} comment{orphanComments.length === 1 ? '' : 's'} on
          outdated lines:
        </p>
        <ul class="space-y-2">
          {#each orphanComments as c (c.id)}
            <li class="rounded border border-border bg-card/40 p-2">
              <div class="font-medium">{c.author}</div>
              <p class="whitespace-pre-wrap">{c.body}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
</section>

<style>
  .diff-host :global(diffs-container) {
    display: block;
    width: 100%;
  }
  /* Pierre's gutter container sits absolute over the line-number cell with
     no z-index. Raise it above the digits and let it fill the gutter so the
     `+` button has a solid backdrop. */
  .diff-host :global([data-gutter-utility-slot]) {
    z-index: 5;
    left: 0;
    right: 0;
    align-items: center;
    justify-content: center;
    background: var(--diffs-bg-num, var(--diffs-bg, transparent));
  }
  /* Pierre's built-in `+` button (with `data-utility-button`). Reskin to
     match the project's default Button variant — primary bg, white icon,
     rounded, with a soft elevation so it pops against the diff line. */
  .diff-host :global([data-utility-button]) {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    cursor: pointer;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.25),
      0 0 0 1px rgba(0, 0, 0, 0.04);
    transition:
      transform 80ms ease,
      box-shadow 80ms ease,
      background-color 80ms ease;
  }
  .diff-host :global([data-utility-button]:hover) {
    background: color-mix(in lab, hsl(var(--primary)) 90%, white);
    transform: scale(1.06);
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.25),
      0 0 0 1px rgba(0, 0, 0, 0.05);
  }
  .diff-host :global([data-utility-button]:focus-visible) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 1px;
  }
  .diff-host :global([data-utility-button] svg) {
    width: 12px;
    height: 12px;
    stroke-width: 2.5;
  }
</style>
