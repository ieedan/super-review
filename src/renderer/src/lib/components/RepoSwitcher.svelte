<script lang="ts">
  import { ChevronDown, Plus, X } from 'lucide-svelte';
  import { Button, buttonVariants } from './ui/button';
  import * as Popover from './ui/popover';
  import * as Command from './ui/command';
  import { actions, app } from '$lib/store.svelte';
  import { cn, repoPlaceholder } from '$lib/utils';
  import type { RepoInfo } from '@shared/types';

  let open = $state(false);

  async function pick(id: string): Promise<void> {
    open = false;
    await actions.switchRepo(id);
  }

  function openAddRepo(): void {
    open = false;
    actions.openAddRepoDialog();
  }

  async function remove(e: MouseEvent, id: string): Promise<void> {
    e.stopPropagation();
    await actions.removeRepo(id);
  }

  function placeholderFor(repo: RepoInfo | null | undefined): {
    initial: string;
    toneClass: string;
  } {
    return repoPlaceholder(repo?.name ?? '');
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'max-w-[260px]')}>
    {#if app.activeRepo?.iconDataUrl}
      <img
        src={app.activeRepo.iconDataUrl}
        alt=""
        class="size-4 rounded-sm object-contain"
      />
    {:else if app.activeRepo}
      {@const { initial, toneClass } = placeholderFor(app.activeRepo)}
      <span
        class={cn(
          'grid size-4 place-items-center rounded-sm text-[9px] font-semibold leading-none',
          toneClass,
        )}
      >
        {initial}
      </span>
    {/if}
    <span class="truncate">{app.activeRepo?.name ?? 'Open repository'}</span>
    <ChevronDown class="size-3.5 text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content align="start" class="w-72 p-0">
    <Command.Root>
      <Command.List class="max-h-[320px]">
        {#if app.repos.length === 0}
          <Command.Empty>No repositories yet</Command.Empty>
        {:else}
          <Command.Group>
            {#each app.repos as repo (repo.id)}
              <Command.Item
                value={`${repo.name} ${repo.path}`}
                onSelect={() => pick(repo.id)}
                class={cn(
                  'group flex items-center gap-2',
                  repo.id === app.activeRepo?.id && 'bg-accent/60',
                )}
              >
                {#if repo.iconDataUrl}
                  <img src={repo.iconDataUrl} alt="" class="size-5 rounded-sm object-contain" />
                {:else}
                  {@const { initial, toneClass } = placeholderFor(repo)}
                  <span
                    class={cn(
                      'grid size-5 place-items-center rounded-sm text-[11px] font-semibold leading-none',
                      toneClass,
                    )}
                  >
                    {initial}
                  </span>
                {/if}
                <span class="min-w-0 flex-1 truncate font-medium">{repo.name}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="-mr-1 opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                  onclick={(e) => remove(e, repo.id)}
                  aria-label="Remove repository"
                >
                  <X class="size-3" />
                </Button>
              </Command.Item>
            {/each}
          </Command.Group>
          <Command.Separator />
        {/if}
        <Command.Group>
          <Command.Item value="__add_repository__" onSelect={openAddRepo}>
            <Plus class="size-4" />
            Add repository…
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
