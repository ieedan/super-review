<script lang="ts">
  import { ChevronDown, FolderOpen, GitBranch, X } from 'lucide-svelte';
  import Button from './ui/Button.svelte';
  import Popover from './ui/Popover.svelte';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  let open = $state(false);

  function close(): void {
    open = false;
  }

  async function pick(id: string): Promise<void> {
    close();
    await actions.switchRepo(id);
  }

  async function openPicker(): Promise<void> {
    close();
    await actions.openRepo();
  }

  async function remove(e: MouseEvent, id: string): Promise<void> {
    e.stopPropagation();
    await actions.removeRepo(id);
  }
</script>

<div class="relative">
  <Button variant="ghost" size="sm" onclick={() => (open = !open)} class="max-w-[260px]">
    {#if app.activeRepo?.iconDataUrl}
      <img
        src={app.activeRepo.iconDataUrl}
        alt=""
        class="size-4 rounded-sm object-contain"
      />
    {:else}
      <GitBranch class="size-3.5 text-muted-foreground" />
    {/if}
    <span class="truncate">{app.activeRepo?.name ?? 'Open repository'}</span>
    <ChevronDown class="size-3.5 text-muted-foreground" />
  </Button>

  <Popover bind:open onClose={close} class="w-80">
    <div class="max-h-80 overflow-auto py-1">
      {#each app.repos as repo (repo.id)}
        <div
          class={cn(
            'group flex w-full items-center gap-2 text-sm hover:bg-accent',
            repo.id === app.activeRepo?.id && 'bg-accent/60',
          )}
        >
          <button
            class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
            onclick={() => pick(repo.id)}
            type="button"
          >
            {#if repo.iconDataUrl}
              <img src={repo.iconDataUrl} alt="" class="size-5 rounded-sm object-contain" />
            {:else}
              <div class="grid size-5 place-items-center rounded-sm bg-muted">
                <GitBranch class="size-3 text-muted-foreground" />
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{repo.name}</div>
              <div class="truncate text-[10px] text-muted-foreground">{repo.path}</div>
            </div>
          </button>
          <button
            class="mr-1 rounded p-0.5 opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
            onclick={(e) => remove(e, repo.id)}
            aria-label="Remove repository"
            type="button"
          >
            <X class="size-3" />
          </button>
        </div>
      {:else}
        <div class="px-3 py-4 text-center text-xs text-muted-foreground">
          No repositories yet
        </div>
      {/each}
    </div>
    <div class="border-t border-border p-1">
      <button
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        onclick={openPicker}
      >
        <FolderOpen class="size-4" />
        Open repository…
      </button>
    </div>
  </Popover>
</div>
