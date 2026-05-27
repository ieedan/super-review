<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  interface Props {
    open: boolean;
    onClose: () => void;
    align?: 'start' | 'end';
    class?: string;
    children?: Snippet;
  }

  let { open = $bindable(false), onClose, align = 'start', class: className = '', children }: Props =
    $props();

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
  <button
    aria-label="Close popover"
    class="fixed inset-0 z-40 cursor-default"
    onclick={onClose}
  ></button>
  <div
    role="dialog"
    class={cn(
      'absolute z-50 mt-1 rounded-md border border-border bg-popover text-popover-foreground shadow-lg',
      align === 'end' ? 'right-0' : 'left-0',
      className,
    )}
  >
    {#if children}{@render children()}{/if}
  </div>
{/if}
