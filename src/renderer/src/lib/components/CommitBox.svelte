<script lang="ts">
  import { Loader2, User } from 'lucide-svelte';
  import { Button } from './ui/button';
  import * as Avatar from './ui/avatar';
  import { Input } from './ui/input';
  import { Textarea } from './ui/textarea';
  import { actions, app } from '$lib/store.svelte';

  let summary = $state('');
  let description = $state('');

  let busy = $derived(app.push.inProgress && app.push.stage === 'committing');
  let fileCount = $derived(app.changedFiles.length);
  let branch = $derived(app.currentBranch ?? 'detached HEAD');
  let canCommit = $derived(!busy && fileCount > 0 && summary.trim().length > 0);

  async function submit(e?: Event): Promise<void> {
    e?.preventDefault();
    if (!canCommit) return;
    const ok = await actions.commit(summary, description);
    if (ok) {
      summary = '';
      description = '';
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  let lastCommit = $derived(app.lastCommit);
  let canUndo = $derived(!busy && (lastCommit?.canUndo ?? false));

  async function undo(): Promise<void> {
    if (!canUndo) return;
    await actions.undoLastCommit();
  }
</script>

<form class="flex flex-col gap-1.5 border-t border-border bg-card/40 p-2" onsubmit={submit}>
  <div class="flex items-center gap-2">
    <Avatar.Root class="size-7 shrink-0">
      {#if app.activeGithubAccount?.avatarUrl}
        <Avatar.Image
          src={app.activeGithubAccount.avatarUrl}
          alt={app.activeGithubAccount.login}
        />
      {/if}
      <Avatar.Fallback class="text-[10px]">
        {#if app.activeGithubAccount}
          {app.activeGithubAccount.login.slice(0, 2).toUpperCase()}
        {:else}
          <User class="size-3.5" />
        {/if}
      </Avatar.Fallback>
    </Avatar.Root>
    <Input
      type="text"
      bind:value={summary}
      placeholder="Summary (required)"
      disabled={busy}
      class="h-7 min-w-0 flex-1 text-xs"
    />
  </div>

  <Textarea
    bind:value={description}
    onkeydown={onKeydown}
    placeholder="Description"
    rows={3}
    disabled={busy}
    class="min-h-0 resize-none px-2 py-1.5 text-xs"
  />

  <Button type="submit" size="sm" class="w-full" disabled={!canCommit}>
    {#if busy}
      <Loader2 class="size-3.5 animate-spin" />
      <span class="text-xs">Committing…</span>
    {:else}
      <span class="truncate text-xs">
        Commit
        {#if fileCount > 0}
          {fileCount} file{fileCount === 1 ? '' : 's'}
        {/if}
        to <span class="font-semibold">{branch}</span>
      </span>
    {/if}
  </Button>
</form>

{#if canUndo && lastCommit}
  <div
    class="flex items-center gap-2 border-t border-border bg-card/40 px-2 py-1.5"
  >
    <div class="min-w-0 flex-1">
      <p class="truncate text-[11px] text-muted-foreground">
        Committed {lastCommit.relativeTime}
      </p>
      <p class="truncate text-xs">{lastCommit.subject}</p>
    </div>
    <Button
      type="button"
      size="sm"
      variant="outline"
      class="h-7 shrink-0 text-xs"
      onclick={undo}
    >
      Undo
    </Button>
  </div>
{/if}
