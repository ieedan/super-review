<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { ArrowDown, Loader2, RefreshCw } from 'lucide-svelte';
  import { buttonVariants } from './ui/button';
  import { actions, app } from '$lib/store.svelte';
  import { cn, formatRelative } from '$lib/utils';

  const pullStage = $derived(app.push.intent === 'pull' ? app.push.stage : 'idle');
  const pulling = $derived(
    app.push.inProgress && app.push.intent === 'pull' && pullStage !== 'conflicts',
  );
  const refreshing = $derived(app.loading.files || app.loading.branches || app.fetchingOrigin);
  const busy = $derived(refreshing || pulling);

  // Switch to pull mode when origin has commits we don't, and we have no
  // local commits to push (the primary action button handles the sync case
  // by pulling-then-pushing).
  const canPull = $derived(
    !!app.pushStatus &&
      app.pushStatus.hasUpstream &&
      app.pushStatus.behind > 0 &&
      app.pushStatus.ahead === 0,
  );
  const mode = $derived<'refresh' | 'pull'>(canPull ? 'pull' : 'refresh');

  const relative = $derived.by(() => {
    void app.nowTick;
    if (!app.lastRefreshAt) return null;
    return formatRelative(new Date(app.lastRefreshAt).toISOString());
  });

  const absolute = $derived.by(() => {
    void app.nowTick;
    if (!app.lastRefreshAt) return null;
    return new Date(app.lastRefreshAt).toLocaleString();
  });

  const behindLabel = $derived.by(() => {
    const s = app.pushStatus;
    if (!s) return null;
    if (s.behind === 0 && s.ahead === 0) return 'Up to date with origin';
    const parts: string[] = [];
    if (s.ahead > 0) parts.push(`${s.ahead} ahead`);
    if (s.behind > 0) parts.push(`${s.behind} behind`);
    return parts.join(' · ');
  });

  const pullTitle = $derived.by(() => {
    const n = app.pushStatus?.behind ?? 0;
    if (pulling) {
      return pullStage === 'fetching' ? 'Fetching origin…' : 'Pulling…';
    }
    return `Pull ${n} commit${n === 1 ? '' : 's'} from origin`;
  });

  function onClick(): void {
    if (busy) return;
    if (mode === 'pull') {
      void actions.pull();
    } else {
      void actions.refresh();
    }
  }
</script>

<TooltipPrimitive.Provider delayDuration={150}>
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger
      class={cn(
        buttonVariants({
          variant: 'ghost',
          size: mode === 'pull' ? 'sm' : 'icon-sm',
        }),
        'relative text-muted-foreground',
      )}
      onclick={onClick}
      disabled={busy}
      aria-label={mode === 'pull' ? 'Pull from origin' : 'Refresh'}
      title={mode === 'pull' ? pullTitle : undefined}
    >
      {#if mode === 'pull'}
        {#if pulling}
          <Loader2 class="size-3.5 animate-spin" />
        {:else}
          <ArrowDown class="size-3.5" />
        {/if}
        <span class="text-xs">
          {#if pulling}
            {pullStage === 'fetching' ? 'Fetching' : 'Pulling'}
          {:else}
            Pull {app.pushStatus?.behind ?? 0}
          {/if}
        </span>
      {:else}
        <RefreshCw class={cn('size-3.5', refreshing && 'animate-spin')} />
        {#if app.pushStatus && app.pushStatus.behind > 0}
          <span
            class="absolute right-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-card"
            aria-hidden="true"
          ></span>
        {/if}
      {/if}
    </TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={6}
        align="end"
        class="z-50 grid gap-1 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md"
      >
        {#if mode === 'pull'}
          <div class="font-medium">{pullTitle}</div>
          {#if behindLabel}
            <div class="text-[10px] text-muted-foreground">{behindLabel}</div>
          {/if}
        {:else}
          <div class="font-medium">
            {#if relative}
              Last refreshed {relative}
            {:else}
              Not refreshed yet
            {/if}
          </div>
          {#if absolute}
            <div class="text-[10px] text-muted-foreground">{absolute}</div>
          {/if}
          {#if behindLabel}
            <div class="border-t border-border pt-1 text-[10px] text-muted-foreground">
              {behindLabel}
            </div>
          {/if}
        {/if}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
</TooltipPrimitive.Provider>
