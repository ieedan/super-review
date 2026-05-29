<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Inbox } from 'lucide-svelte';
  import DiffFileSection from './DiffFileSection.svelte';
  import FindBar from './FindBar.svelte';
  import { app } from '$lib/store.svelte';
  import { openFind, closeFind, setFindRoot, find } from '$lib/diff-find.svelte';
  import type { ChangedFile } from '@shared/types';

  // Mirror the sidebar's path filter so hidden files don't render a diff
  // section here either. Both views read from `app.fileSearchQuery`.
  const visibleFiles = $derived.by<ChangedFile[]>(() => {
    const q = app.fileSearchQuery.trim().toLowerCase();
    if (!q) return app.changedFiles;
    return app.changedFiles.filter((f) => f.path.toLowerCase().includes(q));
  });

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

  // Track which file section is currently being viewed so the sidebar can
  // highlight it. The "active" section is the one whose top has most recently
  // crossed the scroll container's top edge — i.e., the file whose sticky
  // header is pinned. Throttled to one update per animation frame.
  $effect(() => {
    // Read so the effect re-runs (and re-syncs) when the rendered list
    // changes — tab switch, search filter, refresh. The scroll/resize
    // listeners alone don't fire when the DOM is rebuilt at scrollTop 0.
    void visibleFiles;
    if (!scrollContainer) return;
    const el = scrollContainer;
    let ticking = false;

    function updateActiveFile(): void {
      ticking = false;
      const containerTop = el.getBoundingClientRect().top;
      const sections = el.querySelectorAll<HTMLElement>('section[data-file-path]');
      if (sections.length === 0) return;
      let active: string | null = null;
      let activeRelTop = -Infinity;
      for (const section of sections) {
        const relTop = section.getBoundingClientRect().top - containerTop;
        // Section whose top is at or just above the viewport top, picking the
        // one closest to 0 (i.e., the one most recently scrolled into).
        if (relTop <= 1 && relTop > activeRelTop) {
          activeRelTop = relTop;
          active = section.getAttribute('data-file-path');
        }
      }
      // Scrolled above all sections — anchor to the first visible file.
      if (!active) active = sections[0].getAttribute('data-file-path');
      if (active && app.selectedFile !== active) {
        app.selectedFile = active;
      }
    }

    function schedule(): void {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateActiveFile);
    }

    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => {
      el.removeEventListener('scroll', schedule);
      ro.disconnect();
    };
  });

  // Register the scroll container as the search root so the find controller
  // walks only the diff content (not the sidebar, headers, etc).
  $effect(() => {
    setFindRoot(scrollContainer);
    return () => setFindRoot(null);
  });

  // Ctrl/Cmd+F opens (or re-focuses) the find bar from anywhere in the app.
  // The bar itself handles Esc / Enter while focused; this listener just
  // surfaces the bar and bumps `focusNonce` so repeat presses re-focus.
  $effect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      if (!app.activeRepo) return;
      e.preventDefault();
      openFind();
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  onDestroy(() => {
    observer?.disconnect();
    closeFind();
  });
</script>

<section class="relative flex h-full min-w-0 flex-1 flex-col">
  <FindBar />
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
    {:else if visibleFiles.length === 0}
      <div class="grid h-full place-items-center text-muted-foreground">
        <div class="flex flex-col items-center gap-2 text-center">
          <Inbox class="size-8 opacity-40" />
          <p class="text-sm">No files match "{app.fileSearchQuery}"</p>
        </div>
      </div>
    {/if}

    {#each visibleFiles as file, i (file.path)}
      <DiffFileSection
        {file}
        {observer}
        isLast={i === visibleFiles.length - 1}
      />
    {/each}
  </div>
</section>
