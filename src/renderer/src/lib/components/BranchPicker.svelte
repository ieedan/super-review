<script lang="ts">
  import { Command as CommandPrimitive } from 'bits-ui';
  import { ChevronDown, GitBranch, Plus, Search } from 'lucide-svelte';
  import { VirtualList } from '$lib/virtual-list';
  import { Button, buttonVariants } from './ui/button';
  import * as Popover from './ui/popover';
  import * as Command from './ui/command';
  import { actions, app } from '$lib/store.svelte';
  import { cn, formatRelative } from '$lib/utils';
  import type { BranchInfo } from '@shared/types';

  const ITEM_SIZE = 28;
  const MAX_LIST_HEIGHT = 320;

  let open = $state(false);
  let filter = $state('');

  async function checkout(name: string): Promise<void> {
    open = false;
    await actions.checkoutBranch(name);
  }

  function openCreate(): void {
    open = false;
    actions.openCreateBranchDialog();
  }

  type Row =
    | { kind: 'heading'; label: string }
    | { kind: 'branch'; branch: BranchInfo };

  // Flatten the default + recent sections (and their headings) into a single
  // list of rows. Everything lives inside one virtualized scroll container so
  // the whole popover scrolls together rather than the recent list scrolling
  // on its own. Filtering is applied here (rather than via Command's built-in
  // matcher) because the rows are virtualized and not all present in the DOM.
  const rows = $derived.by(() => {
    const defaultName = app.activeRepo?.defaultBranch;
    const needle = filter.trim().toLowerCase();
    const matches = (b: BranchInfo): boolean =>
      needle === '' || b.name.toLowerCase().includes(needle);
    let defaultBranch: BranchInfo | null = null;
    const recent: BranchInfo[] = [];
    for (const b of app.branches) {
      if (defaultName && b.name === defaultName && !defaultBranch) {
        defaultBranch = matches(b) ? b : null;
      } else if (matches(b)) {
        recent.push(b);
      }
    }
    const result: Row[] = [];
    if (defaultBranch) {
      result.push({ kind: 'heading', label: 'Default Branch' });
      result.push({ kind: 'branch', branch: defaultBranch });
    }
    if (recent.length > 0) {
      result.push({ kind: 'heading', label: 'Recent Branches' });
      for (const b of recent) result.push({ kind: 'branch', branch: b });
    }
    return result;
  });

  const listHeight = $derived(
    Math.min(MAX_LIST_HEIGHT, Math.max(ITEM_SIZE, rows.length * ITEM_SIZE)),
  );

  // Re-derive on `nowTick` so the relative timestamps stay live while the
  // popover is open.
  function relativeFor(b: BranchInfo): string | null {
    void app.nowTick;
    if (!b.lastCommitAt) return null;
    return formatRelative(new Date(b.lastCommitAt).toISOString());
  }
</script>

<Popover.Root bind:open onOpenChange={(v) => { if (!v) filter = ''; }}>
  <Popover.Trigger
    disabled={!app.activeRepo}
    class={cn(
      buttonVariants({ variant: 'ghost', size: 'sm' }),
      'font-normal',
    )}
  >
    <GitBranch class="size-3.5 text-muted-foreground" />
    <span>
      {app.currentBranch ?? 'no branch'}
    </span>
    <ChevronDown class="size-3.5 text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content align="start" class="w-[26rem] p-0">
    <Command.Root shouldFilter={false}>
      <!-- Sticky header: search input on the left, "New branch" on the right.
           Both stay visible while the branch list below scrolls. -->
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
        <Button size="sm" class="h-8 shrink-0 gap-1.5" onclick={openCreate}>
          <Plus class="size-3.5" />
          New branch
        </Button>
      </div>

      <Command.List class="max-h-[320px] overflow-hidden">
        {#if app.branches.length === 0}
          <div class="px-3 py-6 text-center text-xs text-muted-foreground">
            No branches
          </div>
        {:else if rows.length === 0}
          <div class="px-3 py-6 text-center text-xs text-muted-foreground">
            No matches
          </div>
        {:else}
          <Command.Group class="p-1">
            <VirtualList
              width="100%"
              itemSize={ITEM_SIZE}
              itemCount={rows.length}
              height={listHeight}
            >
              {#snippet item({ index, style })}
                {@const row = rows[index]}
                <div {style}>
                  {#if row.kind === 'heading'}
                    <div
                      class="px-2 py-1.5 text-xs font-medium text-muted-foreground"
                    >
                      {row.label}
                    </div>
                  {:else}
                    {@const b = row.branch}
                    <Command.Item
                      value={b.name}
                      onSelect={() => checkout(b.name)}
                      class={cn(
                        'flex items-center gap-2',
                        b.current && 'bg-accent/60',
                      )}
                    >
                      <GitBranch
                        class={cn(
                          'size-3.5',
                          b.current ? 'text-success' : 'text-muted-foreground',
                        )}
                      />
                      <span
                        class={cn(
                          'min-w-0 flex-1 truncate font-mono text-xs',
                          b.current && 'font-semibold',
                        )}
                      >
                        {b.name}
                      </span>
                      {#if relativeFor(b)}
                        <span class="shrink-0 text-[10px] text-muted-foreground">
                          {relativeFor(b)}
                        </span>
                      {/if}
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
