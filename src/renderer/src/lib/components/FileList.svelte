<script lang="ts">
  import { Check, FileDiff, FilePlus, FileMinus, FileEdit, FileX, Files, RefreshCw } from 'lucide-svelte';
  import Badge from './ui/Badge.svelte';
  import Button from './ui/Button.svelte';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';
  import type { ChangedFile, FileStatus } from '@shared/types';

  function statusIcon(s: FileStatus): typeof FileDiff {
    switch (s) {
      case 'added':
      case 'untracked':
        return FilePlus;
      case 'deleted':
        return FileMinus;
      case 'renamed':
      case 'copied':
        return FileEdit;
      case 'type-change':
        return FileX;
      default:
        return FileDiff;
    }
  }

  function statusColor(s: FileStatus): string {
    switch (s) {
      case 'added':
      case 'untracked':
        return 'text-success';
      case 'deleted':
        return 'text-destructive';
      case 'renamed':
      case 'copied':
        return 'text-warning';
      default:
        return 'text-muted-foreground';
    }
  }

  function ext(path: string): string {
    const i = path.lastIndexOf('.');
    return i > -1 ? path.slice(i + 1) : '';
  }

  function basename(path: string): string {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return i > -1 ? path.slice(i + 1) : path;
  }

  function dirname(path: string): string {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return i > -1 ? path.slice(0, i) : '';
  }

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

  async function pick(f: ChangedFile): Promise<void> {
    await actions.selectFile(f.path);
  }

  function toggleSeen(e: MouseEvent, f: ChangedFile): void {
    e.stopPropagation();
    void actions.toggleSeen(f.path);
  }
</script>

<aside class="flex h-full w-72 flex-col border-r border-border bg-card/30">
  <div class="flex items-center justify-between border-b border-border px-3 py-2">
    <div class="flex items-center gap-1.5 text-xs">
      <Files class="size-3.5 text-muted-foreground" />
      <span class="font-medium">Files</span>
      <span class="text-muted-foreground">
        {seenCount}/{app.changedFiles.length}
      </span>
    </div>
    <div class="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        title="Refresh"
        onclick={() => actions.refreshFiles()}
      >
        <RefreshCw class={cn('size-3.5', app.loading.files && 'animate-spin')} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Clear seen"
        onclick={() => actions.clearSeen()}
      >
        <Check class="size-3.5" />
      </Button>
    </div>
  </div>

  {#if app.changedFiles.length > 0}
    <div class="border-b border-border px-3 py-1.5 text-[10px] tabular-nums">
      <span class="text-success">+{totals.add}</span>
      <span class="ml-1 text-destructive">−{totals.del}</span>
    </div>
  {/if}

  <div class="flex-1 overflow-auto">
    {#if app.loading.files && app.changedFiles.length === 0}
      <div class="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
    {:else if app.changedFiles.length === 0}
      <div class="px-3 py-8 text-center text-xs text-muted-foreground">
        {#if app.activeRepo}
          No changes
        {:else}
          Open a repository to begin
        {/if}
      </div>
    {/if}

    {#each app.changedFiles as file (file.path)}
      {@const isSeen = app.seenFiles.has(file.path)}
      {@const Icon = statusIcon(file.status)}
      <div
        class={cn(
          'group flex w-full items-center gap-2 border-l-2 border-transparent pr-2 transition-colors',
          app.selectedFile === file.path
            ? 'border-l-foreground bg-accent'
            : 'hover:bg-accent/50',
          isSeen && 'opacity-50',
        )}
      >
        <button
          class={cn(
            'ml-2 grid size-4 shrink-0 place-items-center rounded border',
            isSeen
              ? 'border-success bg-success text-success-foreground'
              : 'border-border hover:border-foreground',
          )}
          onclick={(e) => toggleSeen(e, file)}
          aria-label={isSeen ? 'Mark unseen' : 'Mark seen'}
          type="button"
        >
          {#if isSeen}
            <Check class="size-2.5" />
          {/if}
        </button>
        <button
          class="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
          onclick={() => pick(file)}
          type="button"
        >
          <Icon class={cn('size-3.5 shrink-0', statusColor(file.status))} />
          <div class="min-w-0 flex-1">
            <div class={cn('truncate text-xs', isSeen && 'line-through')}>
              {basename(file.path)}
            </div>
            {#if dirname(file.path)}
              <div class="truncate text-[10px] text-muted-foreground">
                {dirname(file.path)}
              </div>
            {/if}
          </div>
          <div class="flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums">
            {#if !file.isBinary}
              <span class="text-success">+{file.additions}</span>
              <span class="text-destructive">−{file.deletions}</span>
            {:else}
              <Badge variant="muted">bin</Badge>
            {/if}
          </div>
          {#if file.status === 'renamed'}
            <Badge variant="warning">R</Badge>
          {/if}
          {#if ext(file.path) === 'lock' || ext(file.path) === 'lockb'}
            <Badge variant="muted">lock</Badge>
          {/if}
        </button>
      </div>
    {/each}
  </div>
</aside>
