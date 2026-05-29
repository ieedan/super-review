<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui';
  import { ChevronDown, Plus, Search, X } from 'lucide-svelte';
  import { VirtualList } from '$lib/virtual-list';
  import { Button, buttonVariants } from './ui/button';
  import * as Popover from './ui/popover';
  import * as Command from './ui/command';
  import { actions, app } from '$lib/store.svelte';
  import { cn, repoPlaceholder } from '$lib/utils';
  import type { RepoInfo } from '@shared/types';

  const ITEM_SIZE = 36;
  const HEADER_SIZE = 28;
  // The VirtualList is the scroll container. Cap it so it plus the surrounding
  // Command.Group's `p-1` (8px) fits within Command.List's 320px max-height —
  // otherwise the group overflows and the last row's bottom padding gets
  // clipped.
  const MAX_LIST_HEIGHT = 312;
  const RECENT_COUNT = 3;
  const OTHER_OWNER = 'Other';

  type Row =
    | { kind: 'header'; label: string }
    | { kind: 'repo'; repo: RepoInfo };

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

  // Mirror GitHub Desktop's repo picker: a "Recent" section of the few most
  // recently opened repos, followed by every repo grouped under its owner
  // (recent repos still appear in their owner group too). Filtering is applied
  // here — rather than via Command's built-in matcher — because the list is
  // virtualized and its items are not all present in the DOM. While filtering,
  // the Recent section is dropped and only the owner groups are shown.
  const rows = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = app.repos.filter(
      (r) =>
        needle === '' ||
        r.name.toLowerCase().includes(needle) ||
        r.path.toLowerCase().includes(needle),
    );

    const result: Row[] = [];

    if (needle === '') {
      const recent = [...filtered]
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
        .slice(0, RECENT_COUNT);
      if (recent.length > 0) {
        result.push({ kind: 'header', label: 'Recent' });
        for (const repo of recent) result.push({ kind: 'repo', repo });
      }
    }

    // Group by owner. Repos without a GitHub owner fall under "Other".
    const groups = new Map<string, RepoInfo[]>();
    for (const repo of filtered) {
      const owner = repo.githubOwner?.trim() || OTHER_OWNER;
      (groups.get(owner) ?? groups.set(owner, []).get(owner)!).push(repo);
    }

    const ownerNames = [...groups.keys()].sort((a, b) => {
      // Keep the catch-all bucket last; otherwise sort owners alphabetically.
      if (a === OTHER_OWNER) return 1;
      if (b === OTHER_OWNER) return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });

    for (const owner of ownerNames) {
      result.push({ kind: 'header', label: owner });
      const repos = groups
        .get(owner)!
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      for (const repo of repos) result.push({ kind: 'repo', repo });
    }

    return result;
  });

  function rowSize(index: number): number {
    return rows[index]?.kind === 'header' ? HEADER_SIZE : ITEM_SIZE;
  }

  const listHeight = $derived(
    Math.min(
      MAX_LIST_HEIGHT,
      Math.max(
        ITEM_SIZE,
        rows.reduce((sum, row) => sum + (row.kind === 'header' ? HEADER_SIZE : ITEM_SIZE), 0),
      ),
    ),
  );
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
    <Command.Root shouldFilter={false}>
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

      <Command.List class="max-h-[320px] overflow-hidden">
        {#if app.repos.length === 0}
          <div class="px-3 py-6 text-center text-xs text-muted-foreground">
            No repositories yet
          </div>
        {:else if rows.length === 0}
          <div class="px-3 py-6 text-center text-xs text-muted-foreground">
            No matches
          </div>
        {:else}
          <Command.Group>
            <VirtualList
              width="100%"
              itemSize={rowSize}
              itemCount={rows.length}
              height={listHeight}
            >
              {#snippet item({ index, style })}
                {@const row = rows[index]}
                <div {style}>
                  {#if row.kind === 'header'}
                    <div
                      class="flex h-full items-center truncate px-2 text-xs font-semibold text-muted-foreground"
                    >
                      {row.label}
                    </div>
                  {:else}
                    {@const repo = row.repo}
                    <Command.Item
                      value={`${index}-${repo.name} ${repo.path}`}
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
                  {/if}
                </div>
              {/snippet}
            </VirtualList>
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
