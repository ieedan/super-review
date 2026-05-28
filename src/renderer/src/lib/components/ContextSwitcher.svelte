<script lang="ts">
  import { ChevronDown, GitBranch, GitCommit, GitPullRequest, FilePen } from 'lucide-svelte';
  import { Button, buttonVariants } from './ui/button';
  import * as Popover from './ui/popover';
  import * as Tabs from './ui/tabs';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  type Tab = 'workingTree' | 'branches' | 'prs';
  let open = $state(false);
  let tab = $state<Tab>('workingTree');
  let baseInput = $state('main');
  let headInput = $state('HEAD');

  function close(): void {
    open = false;
  }

  function ctxLabel(): string {
    const c = app.diffContext;
    if (c.kind === 'workingTree') {
      return app.currentBranch
        ? `${app.currentBranch} (working tree)`
        : 'Working tree';
    }
    if (c.kind === 'branch') return `${c.base}…${c.head}`;
    return `PR #${c.prNumber}`;
  }

  function ctxIcon(): typeof GitBranch {
    const c = app.diffContext;
    if (c.kind === 'workingTree') return FilePen;
    if (c.kind === 'pr') return GitPullRequest;
    return GitCommit;
  }

  $effect(() => {
    if (open && tab === 'prs' && app.activeGithubAccount && app.prs.length === 0) {
      void actions.loadPRs();
    }
  });

  async function setWorking(): Promise<void> {
    close();
    await actions.setDiffContext({ kind: 'workingTree' });
  }

  async function setBranchCompare(): Promise<void> {
    close();
    if (baseInput && headInput) {
      await actions.setDiffContext({ kind: 'branch', base: baseInput, head: headInput });
    }
  }

  async function checkoutBranch(name: string): Promise<void> {
    close();
    await actions.checkoutBranch(name);
  }

  async function reviewPR(num: number): Promise<void> {
    close();
    await actions.reviewPR(num);
  }

  let Icon = $derived(ctxIcon());
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    disabled={!app.activeRepo}
    class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'max-w-[280px]')}
  >
    <Icon class="size-3.5 text-muted-foreground" />
    <span class="truncate">{ctxLabel()}</span>
    <ChevronDown class="size-3.5 text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content align="start" class="w-[420px] p-0">
    <Tabs.Root value={tab} onValueChange={(v) => (tab = v as Tab)} class="gap-0">
      <Tabs.List class="grid w-full grid-cols-3 rounded-none rounded-t-lg">
        <Tabs.Trigger value="workingTree">Working tree</Tabs.Trigger>
        <Tabs.Trigger value="branches">Branches</Tabs.Trigger>
        <Tabs.Trigger value="prs">Pull requests</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="workingTree" class="p-3 text-sm">
        <p class="text-muted-foreground">
          Show uncommitted changes against <code class="rounded bg-muted px-1">HEAD</code>.
        </p>
        <Button size="sm" class="mt-2 w-full" onclick={setWorking}>
          View working tree
        </Button>
        <div class="mt-4 space-y-2 border-t border-border pt-3 text-xs">
          <p class="font-medium">Compare two refs</p>
          <div class="flex items-center gap-1.5">
            <input
              class="flex-1 rounded border border-input bg-background px-2 py-1 font-mono"
              placeholder="base"
              bind:value={baseInput}
            />
            <span class="text-muted-foreground">…</span>
            <input
              class="flex-1 rounded border border-input bg-background px-2 py-1 font-mono"
              placeholder="head"
              bind:value={headInput}
            />
          </div>
          <Button size="sm" variant="secondary" class="w-full" onclick={setBranchCompare}>
            Compare
          </Button>
        </div>
      </Tabs.Content>

      <Tabs.Content value="branches" class="max-h-80 overflow-auto py-1 text-sm">
        {#each app.branches as b (b.name)}
          <button
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
            onclick={() => checkoutBranch(b.name)}
          >
            <GitBranch class={cn('size-3.5', b.current ? 'text-success' : 'text-muted-foreground')} />
            <span class={cn('truncate font-mono text-xs', b.current && 'font-semibold')}>
              {b.name}
            </span>
            {#if b.isRemote}
              <span class="ml-auto text-[10px] text-muted-foreground">remote</span>
            {/if}
          </button>
        {:else}
          <div class="px-3 py-4 text-center text-xs text-muted-foreground">No branches</div>
        {/each}
      </Tabs.Content>

      <Tabs.Content value="prs" class="max-h-80 overflow-auto py-1 text-sm">
        {#if !app.activeGithubAccount}
          <div class="px-3 py-6 text-center text-xs text-muted-foreground">
            Sign in to GitHub to view pull requests.
          </div>
        {:else if app.loading.prs}
          <div class="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
        {:else}
          {#each app.prs as pr (pr.number)}
            <button
              class="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent"
              onclick={() => reviewPR(pr.number)}
            >
              {#if pr.authorAvatarUrl}
                <img src={pr.authorAvatarUrl} alt="" class="mt-0.5 size-5 rounded-full" />
              {:else}
                <GitPullRequest class="mt-0.5 size-4 text-muted-foreground" />
              {/if}
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1">
                  <span class="text-muted-foreground">#{pr.number}</span>
                  <span class="truncate font-medium">{pr.title}</span>
                </div>
                <div class="truncate text-[10px] text-muted-foreground">
                  {pr.author} • {pr.headRef} → {pr.baseRef}
                  {#if pr.draft}• draft{/if}
                </div>
              </div>
            </button>
          {:else}
            <div class="px-3 py-6 text-center text-xs text-muted-foreground">No open PRs</div>
          {/each}
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  </Popover.Content>
</Popover.Root>
