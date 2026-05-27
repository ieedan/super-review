<script lang="ts">
  import { onMount } from 'svelte';
  import { X } from 'lucide-svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import FileList from '$lib/components/FileList.svelte';
  import DiffView from '$lib/components/DiffView.svelte';
  import { actions, setError, app } from '$lib/store.svelte';

  onMount(() => {
    void actions.init();
    return window.api.events.onRepoChanged((repo) => {
      // active repo updated externally (e.g. another window picked a new repo)
      if (repo) {
        void actions.switchRepo(repo.id);
      }
    });
  });
</script>

<div class="flex h-full flex-col">
  <TopBar />
  <main class="flex min-h-0 flex-1">
    {#if !app.activeRepo}
      <div class="grid h-full w-full place-items-center text-center">
        <div class="max-w-md">
          <h1 class="text-2xl font-semibold">Super Local Review</h1>
          <p class="mt-2 text-sm text-muted-foreground">
            Open a git repository to start reviewing changes.
          </p>
          <button
            class="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onclick={() => actions.openRepo()}
          >
            Open repository…
          </button>
        </div>
      </div>
    {:else}
      <FileList />
      <DiffView />
    {/if}
  </main>

  {#if app.error}
    <div
      role="status"
      class="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive shadow-lg backdrop-blur"
    >
      <span class="flex-1">{app.error}</span>
      <button
        class="rounded p-0.5 hover:bg-destructive/20"
        onclick={() => setError(null)}
        aria-label="Dismiss"
      >
        <X class="size-3.5" />
      </button>
    </div>
  {/if}
</div>
