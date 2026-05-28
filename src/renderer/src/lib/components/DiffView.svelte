<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Inbox } from 'lucide-svelte';
  import DiffFileSection from './DiffFileSection.svelte';
  import { app } from '$lib/store.svelte';

  let scrollContainer = $state<HTMLElement | null>(null);
  let observer = $state<IntersectionObserver | null>(null);
  let lastNonce = 0;

  // Shared observer for all file sections. Each section flips its `inView` flag
  // through a setter stashed on its root element when it enters the rootMargin
  // region — the section then triggers a fetch + render on first intersection.
  $effect(() => {
    if (!scrollContainer) return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const setter = (entry.target as HTMLElement & {
            __setInView?: (v: boolean) => void;
          }).__setInView;
          setter?.(entry.isIntersecting);
        }
      },
      {
        root: scrollContainer,
        // Render diffs a viewport ahead so they're ready by the time the user
        // scrolls there.
        rootMargin: '600px 0px',
        threshold: 0,
      },
    );
    return () => observer?.disconnect();
  });

  // Honor scroll requests from the sidebar tree.
  $effect(() => {
    const req = app.scrollRequest;
    if (!req || req.nonce === lastNonce || !scrollContainer) return;
    lastNonce = req.nonce;
    const target = scrollContainer.querySelector(
      `[data-file-path="${CSS.escape(req.path)}"]`,
    );
    if (target) {
      (target as HTMLElement).scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  });

  onDestroy(() => observer?.disconnect());
</script>

<section class="flex h-full min-w-0 flex-1 flex-col">
  <div bind:this={scrollContainer} class="flex-1 overflow-auto">
    {#if app.changedFiles.length === 0}
      <div class="grid h-full place-items-center text-muted-foreground">
        <div class="flex flex-col items-center gap-2 text-center">
          <Inbox class="size-8 opacity-40" />
          <p class="text-sm">
            {app.loading.files ? 'Loading…' : 'No changes'}
          </p>
        </div>
      </div>
    {/if}

    {#each app.changedFiles as file (file.path)}
      <DiffFileSection {file} {observer} />
    {/each}
  </div>
</section>
