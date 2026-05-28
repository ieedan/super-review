<script lang="ts">
  import { ChevronLeft, Download, FolderOpen, Loader2, Plus } from 'lucide-svelte';
  import * as Dialog from './ui/dialog';
  import { Button } from './ui/button';
  import { actions, app } from '$lib/store.svelte';

  type Mode = 'choose' | 'clone';

  let mode = $state<Mode>('choose');
  let cloneUrl = $state('');
  let busy = $state(false);

  // Reset whenever the dialog is closed so reopening starts fresh.
  $effect(() => {
    if (!app.addRepoDialogOpen) {
      mode = 'choose';
      cloneUrl = '';
      busy = false;
    }
  });

  async function openExisting(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await actions.openRepo();
      actions.closeAddRepoDialog();
    } finally {
      busy = false;
    }
  }

  async function createNew(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await actions.createRepo();
      actions.closeAddRepoDialog();
    } finally {
      busy = false;
    }
  }

  async function submitClone(e?: Event): Promise<void> {
    e?.preventDefault();
    if (busy || !cloneUrl.trim()) return;
    busy = true;
    try {
      await actions.cloneRepo(cloneUrl.trim());
      actions.closeAddRepoDialog();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root
  open={app.addRepoDialogOpen}
  onOpenChange={(v) => (v ? actions.openAddRepoDialog() : actions.closeAddRepoDialog())}
>
  <Dialog.Content class="overflow-hidden sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2 text-base">
        {#if mode === 'clone'}
          <Download class="size-4" /> Clone repository
        {:else}
          Add repository
        {/if}
      </Dialog.Title>
      <Dialog.Description>
        {#if mode === 'clone'}
          Paste a Git URL — you'll pick a destination folder next.
        {:else}
          Open an existing folder, clone from a URL, or create a new repository.
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    {#if mode === 'choose'}
      <div class="grid gap-2">
        <button
          type="button"
          class="flex items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
          onclick={openExisting}
          disabled={busy}
        >
          <FolderOpen class="mt-0.5 size-4 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">Open existing repository</div>
            <div class="text-xs text-muted-foreground">
              Pick a folder that's already a git repo.
            </div>
          </div>
        </button>
        <button
          type="button"
          class="flex items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
          onclick={() => (mode = 'clone')}
          disabled={busy}
        >
          <Download class="mt-0.5 size-4 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">Clone from URL</div>
            <div class="text-xs text-muted-foreground">
              Clone a remote repository into a local folder.
            </div>
          </div>
        </button>
        <button
          type="button"
          class="flex items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
          onclick={createNew}
          disabled={busy}
        >
          <Plus class="mt-0.5 size-4 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">Create new repository</div>
            <div class="text-xs text-muted-foreground">
              Run <code class="font-mono text-[11px]">git init</code> in a folder you choose.
            </div>
          </div>
        </button>
      </div>
      <Dialog.Footer>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onclick={() => actions.closeAddRepoDialog()}
        >
          Cancel
        </Button>
      </Dialog.Footer>
    {:else}
      <form class="grid gap-3" onsubmit={submitClone}>
        <input
          type="text"
          bind:value={cloneUrl}
          placeholder="https://github.com/owner/repo.git"
          class="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={busy}
          autofocus
        />
        <Dialog.Footer>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onclick={() => (mode = 'choose')}
          >
            <ChevronLeft class="size-3.5" /> Back
          </Button>
          <Button type="submit" size="sm" disabled={busy || !cloneUrl.trim()}>
            {#if busy}
              <Loader2 class="size-3.5 animate-spin" /> Cloning…
            {:else}
              Clone
            {/if}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
