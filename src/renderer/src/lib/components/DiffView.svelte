<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Check, Columns2, Rows3, ExternalLink, Eye } from 'lucide-svelte';
  import { FileDiff, parseDiffFromFile, parsePatchFiles } from '@pierre/diffs';
  import Button from './ui/Button.svelte';
  import Badge from './ui/Badge.svelte';
  import { actions, app } from '$lib/store.svelte';
  import type { DiffContext, DiffData } from '@shared/types';

  let container = $state<HTMLElement | null>(null);
  let instance: FileDiff<undefined> | null = null;
  let currentDiff = $state<DiffData | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  function disposeDiff(): void {
    if (instance) {
      try {
        instance.cleanUp();
      } catch {
        // ignore
      }
      instance = null;
    }
    if (container) {
      container.replaceChildren();
    }
  }

  function renderDiff(diff: DiffData): void {
    if (!container) return;
    disposeDiff();

    if (diff.file.isBinary) return;

    instance = new FileDiff<undefined>({
      diffStyle: app.viewMode,
    });

    let metadata: ReturnType<typeof parseDiffFromFile> | undefined;
    let oldFile: { name: string; contents: string } | undefined;
    let newFile: { name: string; contents: string } | undefined;

    const namePair = {
      old: diff.file.oldPath ?? diff.file.path,
      new: diff.file.path,
    };

    if (diff.oldContents || diff.newContents) {
      oldFile = { name: namePair.old, contents: diff.oldContents };
      newFile = { name: namePair.new, contents: diff.newContents };
      try {
        metadata = parseDiffFromFile(oldFile, newFile);
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
      }
    }

    // Fall back to parsing the raw patch if file contents weren't available
    // (e.g. binary, too large, or a partial diff from working tree).
    if (!metadata && diff.patch) {
      try {
        const parsed = parsePatchFiles(diff.patch);
        metadata = parsed[0]?.files?.[0];
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!metadata || !instance) return;

    try {
      instance.render({
        fileContainer: container,
        fileDiff: metadata,
        oldFile,
        newFile,
      });
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  // Load diff whenever selection/context changes
  $effect(() => {
    const file = app.selectedFile;
    const repo = app.activeRepo;
    const ctx = $state.snapshot(app.diffContext) as DiffContext;
    if (!file || !repo) {
      disposeDiff();
      currentDiff = null;
      return;
    }
    loading = true;
    loadError = null;
    void window.api.git
      .getDiff(repo.id, file, ctx)
      .then((d) => {
        currentDiff = d;
        renderDiff(d);
      })
      .catch((err) => {
        loadError = err instanceof Error ? err.message : String(err);
        currentDiff = null;
        disposeDiff();
      })
      .finally(() => {
        loading = false;
      });
  });

  // Re-render when view mode toggles
  $effect(() => {
    void app.viewMode;
    if (currentDiff) renderDiff(currentDiff);
  });

  onDestroy(disposeDiff);

  let isSeen = $derived(
    app.selectedFile ? app.seenFiles.has(app.selectedFile) : false,
  );
</script>

<section class="flex h-full min-w-0 flex-1 flex-col">
  <div class="flex items-center justify-between border-b border-border px-3 py-2">
    <div class="flex min-w-0 items-center gap-2">
      {#if app.selectedFile && currentDiff}
        <span class="truncate font-mono text-xs" title={app.selectedFile}>
          {app.selectedFile}
        </span>
        {#if currentDiff.file.isBinary}
          <Badge variant="muted">binary</Badge>
        {/if}
        {#if currentDiff.truncated}
          <Badge variant="warning">truncated</Badge>
        {/if}
      {:else if app.activeRepo}
        <span class="text-xs text-muted-foreground">Select a file to view its diff</span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => actions.toggleViewMode()}
        title="Toggle split / unified"
      >
        {#if app.viewMode === 'split'}
          <Columns2 class="size-3.5" />
          <span class="hidden sm:inline">Split</span>
        {:else}
          <Rows3 class="size-3.5" />
          <span class="hidden sm:inline">Unified</span>
        {/if}
      </Button>
      {#if app.selectedFile}
        <Button
          variant={isSeen ? 'secondary' : 'outline'}
          size="sm"
          onclick={() => app.selectedFile && actions.toggleSeen(app.selectedFile)}
        >
          {#if isSeen}
            <Check class="size-3.5" /> Seen
          {:else}
            <Eye class="size-3.5" /> Mark seen
          {/if}
        </Button>
      {/if}
    </div>
  </div>

  <div class="relative flex-1 overflow-auto bg-card/20">
    {#if loadError}
      <div class="p-6 text-sm text-destructive">{loadError}</div>
    {:else if loading}
      <div class="p-6 text-sm text-muted-foreground">Loading diff…</div>
    {:else if !app.selectedFile}
      <div class="grid h-full place-items-center text-muted-foreground">
        <div class="flex flex-col items-center gap-2 text-center">
          <ExternalLink class="size-8 opacity-40" />
          <p class="text-sm">No file selected</p>
        </div>
      </div>
    {:else if currentDiff?.file.isBinary}
      <div class="p-6 text-sm text-muted-foreground">Binary file — diff not shown.</div>
    {:else if currentDiff?.truncated}
      <div class="p-6 text-sm text-muted-foreground">
        File too large to render. Diff preview disabled.
      </div>
    {/if}
    <div bind:this={container} class="diff-host px-1"></div>
  </div>
</section>

<style>
  .diff-host :global(diffs-container) {
    width: 100%;
  }
</style>
