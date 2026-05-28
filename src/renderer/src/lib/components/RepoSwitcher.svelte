<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui';
  import { ChevronDown, Plus, Search, X } from 'lucide-svelte';
  import { Button, buttonVariants } from './ui/button';
  import * as Popover from './ui/popover';
  import * as Command from './ui/command';
  import { actions, app } from '$lib/store.svelte';
  import { cn, repoPlaceholder } from '$lib/utils';
  import { repoFrecency } from '$lib/repo-frecency.svelte';
  import type { RepoInfo } from '@shared/types';

  let open = $state(false);
  let filter = $state('');

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

  // Resolve the order from frecency (uses desc, lastUsage tiebreaker). Repos
  // without a frecency entry fall to the bottom, themselves sorted by their
  // existing `lastOpenedAt`.
  let sortedRepos = $derived.by(() => {
    const order = new Map(repoFrecency.items.map((id, i) => [id, i]));
    return [...app.repos].sort((a, b) => {
      const ai = order.get(a.id) ?? Infinity;
      const bi = order.get(b.id) ?? Infinity;
      if (ai !== bi) return ai - bi;
      return b.lastOpenedAt - a.lastOpenedAt;
    });
  });
</script>

<Popover.Root bind:open onOpenChange={(v) => { if (!v) filter = ''; }}>
  <Popover.Trigger
    class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'max-w-[260px]')}
  >
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
  <Popover.Content align="start" class="w-[26rem] p-0">
    <Command.Root shouldFilter={true}>
      <!-- Sticky header: filter on the left, primary Add button on the right.
           Both stay visible while the repo list scrolls. -->
      <div class="flex items-center gap-2 border-b border-border p-2">
        <div
          class="flex h-8 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2"
        >
          <Search class="size-3.5 shrink-0 text-muted-foreground" />
          <CommandPrimitive.Input
            bind:value={filter}
            placeholder="Filter…"
            class="flex h-full w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
          />
        </div>
        <Button size="sm" class="h-8 shrink-0 gap-1.5" onclick={openAddRepo}>
          <Plus class="size-3.5" />
          Add repository
        </Button>
      </div>

      <Command.List class="max-h-[320px]">
        {#if app.repos.length === 0}
          <div class="px-3 py-6 text-center text-xs text-muted-foreground">
            No repositories yet
          </div>
        {:else}
          <Command.Empty>No matches</Command.Empty>
          <Command.Group>
            {#each sortedRepos as repo (repo.id)}
              <Command.Item
                value={`${repo.name} ${repo.path}`}
                onSelect={() => pick(repo.id)}
                class={cn(
                  'group flex items-center gap-2',
                  repo.id === app.activeRepo?.id && 'bg-accent/60',
                )}
              >
                {#if repo.iconDataUrl}
                  <img
                    src={repo.iconDataUrl}
                    alt=""
                    class="size-5 rounded-sm object-contain"
                  />
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
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
