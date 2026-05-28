<script lang="ts">
  import { ChevronDown, GitBranch, Search } from 'lucide-svelte';
  import { buttonVariants } from './ui/button';
  import * as Popover from './ui/popover';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  let open = $state(false);
  let query = $state('');

  let filtered = $derived(
    query.trim()
      ? app.branches.filter((b) =>
          b.name.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : app.branches,
  );

  async function checkout(name: string): Promise<void> {
    open = false;
    query = '';
    await actions.checkoutBranch(name);
  }

  // Reset the search when the popover closes so reopening starts fresh.
  $effect(() => {
    if (!open) query = '';
  });
</script>

<Popover.Root bind:open>
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
  <Popover.Content align="start" class="w-72 p-0">
    <div class="relative border-b border-border">
      <Search class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        class="w-full bg-transparent py-2 pl-7 pr-2 text-xs outline-none"
        placeholder="Find a branch…"
        bind:value={query}
      />
    </div>
    <div class="max-h-80 overflow-auto py-1 text-sm">
      {#each filtered as b (b.name)}
        <button
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
          onclick={() => checkout(b.name)}
          type="button"
        >
          <GitBranch
            class={cn('size-3.5', b.current ? 'text-success' : 'text-muted-foreground')}
          />
          <span class={cn('truncate font-mono text-xs', b.current && 'font-semibold')}>
            {b.name}
          </span>
          {#if b.isRemote}
            <span class="ml-auto text-[10px] text-muted-foreground">remote</span>
          {/if}
        </button>
      {:else}
        <div class="px-3 py-4 text-center text-xs text-muted-foreground">
          {query ? 'No matches' : 'No branches'}
        </div>
      {/each}
    </div>
  </Popover.Content>
</Popover.Root>
