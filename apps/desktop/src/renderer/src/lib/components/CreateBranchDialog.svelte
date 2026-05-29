<script lang="ts">
  import { GitBranch, Loader2 } from 'lucide-svelte';
  import * as Dialog from './ui/dialog';
  import { Button } from './ui/button';
  import { Input } from './ui/input';
  import { RadioGroup, RadioGroupItem } from './ui/radio-group';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  type BaseChoice = 'default' | 'current';
  type BringChoice = 'bring' | 'leave';
  type Step = 'base' | 'bring';

  let name = $state('');
  let baseChoice = $state<BaseChoice>('default');
  let bringChoice = $state<BringChoice>('bring');
  let dirty = $state(false);
  let step = $state<Step>('base');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const defaultBranch = $derived(app.activeRepo?.defaultBranch ?? null);
  const currentBranch = $derived(app.currentBranch ?? null);
  const showCurrentOption = $derived(
    !!currentBranch && currentBranch !== defaultBranch,
  );

  const baseRef = $derived(
    baseChoice === 'default' && defaultBranch
      ? defaultBranch
      : currentBranch ?? defaultBranch ?? undefined,
  );

  // Step 2 (the "bring my changes" question) is only relevant when the user
  // would otherwise be switching into a dirty working tree.
  const needsBringStep = $derived(dirty && !!currentBranch);
  const canAdvance = $derived(!!name.trim() && !!baseRef && !busy);
  const canSubmit = $derived(canAdvance);

  $effect(() => {
    if (!app.createBranchDialogOpen) {
      name = '';
      baseChoice = 'default';
      bringChoice = 'bring';
      dirty = false;
      step = 'base';
      busy = false;
      error = null;
      return;
    }
    if (!defaultBranch && currentBranch) baseChoice = 'current';
    if (!app.activeRepo) return;
    const repoId = app.activeRepo.id;
    void window.api.git.isDirty(repoId).then((d) => {
      if (app.activeRepo?.id === repoId && app.createBranchDialogOpen) {
        dirty = d;
      }
    });
  });

  function advance(e?: Event): void {
    e?.preventDefault();
    if (!canAdvance) return;
    if (needsBringStep) {
      step = 'bring';
    } else {
      void submit();
    }
  }

  async function submit(e?: Event): Promise<void> {
    e?.preventDefault();
    if (!canSubmit) return;
    busy = true;
    error = null;
    try {
      const ok = await actions.createBranch(name.trim(), {
        base: baseRef,
        bringChanges: needsBringStep ? bringChoice === 'bring' : true,
      });
      if (ok) {
        actions.closeCreateBranchDialog();
      }
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root
  open={app.createBranchDialogOpen}
  onOpenChange={(v) =>
    v ? actions.openCreateBranchDialog() : actions.closeCreateBranchDialog()}
>
  <Dialog.Content class="overflow-hidden sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2 text-base">
        <GitBranch class="size-4" />
        {step === 'base' ? 'Create a Branch' : 'Bring your changes?'}
      </Dialog.Title>
    </Dialog.Header>

    {#if step === 'base'}
      <form class="grid gap-4" onsubmit={advance}>
        <div class="grid gap-1.5">
          <label for="create-branch-name" class="text-xs font-medium">Name</label>
          <Input
            id="create-branch-name"
            type="text"
            bind:value={name}
            placeholder="new-branch-name"
            class="font-mono text-xs"
            disabled={busy}
            autofocus
          />
        </div>

        {#if defaultBranch || showCurrentOption}
          <div class="grid gap-2">
            <div class="text-xs font-medium">Create branch based on…</div>
            <RadioGroup bind:value={baseChoice} disabled={busy} class="gap-2">
              {#if defaultBranch}
                <label
                  for="branch-base-default"
                  class={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent',
                    baseChoice === 'default' && 'border-ring bg-accent/40',
                  )}
                >
                  <RadioGroupItem
                    id="branch-base-default"
                    value="default"
                    class="mt-0.5"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium">{defaultBranch}</div>
                    <div class="text-xs text-muted-foreground">
                      The default branch in your repository. Pick this to start
                      on something new that's not dependent on your current
                      branch.
                    </div>
                  </div>
                </label>
              {/if}
              {#if showCurrentOption && currentBranch}
                <label
                  for="branch-base-current"
                  class={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent',
                    baseChoice === 'current' && 'border-ring bg-accent/40',
                  )}
                >
                  <RadioGroupItem
                    id="branch-base-current"
                    value="current"
                    class="mt-0.5"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{currentBranch}</div>
                    <div class="text-xs text-muted-foreground">
                      The currently checked out branch. Pick this if you need to
                      build on work done on this branch.
                    </div>
                  </div>
                </label>
              {/if}
            </RadioGroup>
          </div>
        {/if}

        {#if error}
          <div
            class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        {/if}

        <Dialog.Footer>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onclick={() => actions.closeCreateBranchDialog()}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canAdvance}>
            {#if needsBringStep}
              Continue
            {:else if busy}
              <Loader2 class="size-3.5 animate-spin" /> Creating…
            {:else}
              Create Branch
            {/if}
          </Button>
        </Dialog.Footer>
      </form>
    {:else}
      <form class="grid gap-4" onsubmit={submit}>
        <p class="text-xs text-muted-foreground">
          You have uncommitted changes on
          <span class="font-mono">{currentBranch}</span>. Choose where they
          should go.
        </p>

        <RadioGroup bind:value={bringChoice} disabled={busy} class="gap-2">
          <label
            for="branch-bring-bring"
            class={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent',
              bringChoice === 'bring' && 'border-ring bg-accent/40',
            )}
          >
            <RadioGroupItem
              id="branch-bring-bring"
              value="bring"
              class="mt-0.5"
            />
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium">
                Bring my changes to {name.trim() || 'new branch'}
              </div>
              <div class="text-xs text-muted-foreground">
                Switch to the new branch and keep your uncommitted changes.
              </div>
            </div>
          </label>
          <label
            for="branch-bring-leave"
            class={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent',
              bringChoice === 'leave' && 'border-ring bg-accent/40',
            )}
          >
            <RadioGroupItem
              id="branch-bring-leave"
              value="leave"
              class="mt-0.5"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">
                Leave my changes on {currentBranch}
              </div>
              <div class="text-xs text-muted-foreground">
                Create the branch but stay here so you can keep working.
              </div>
            </div>
          </label>
        </RadioGroup>

        {#if error}
          <div
            class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        {/if}

        <Dialog.Footer>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onclick={() => (step = 'base')}
          >
            Back
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {#if busy}
              <Loader2 class="size-3.5 animate-spin" /> Creating…
            {:else}
              Create Branch
            {/if}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
