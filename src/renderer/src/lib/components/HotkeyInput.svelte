<script lang="ts">
  import { Kbd } from './ui/kbd';
  import { app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';
  import {
    formatHotkeyParts,
    isModifierKey,
    normalizeHotkeyKey,
    type Hotkey,
  } from '@shared/hotkeys';

  let {
    value,
    onChange,
    conflict = false,
  }: {
    value: Hotkey;
    onChange: (hk: Hotkey) => void;
    conflict?: boolean;
  } = $props();

  let recording = $state(false);
  const isMac = $derived(app.platform === 'darwin');
  const parts = $derived(formatHotkeyParts(value, isMac));

  // While recording, capture the next non-modifier keypress as the binding.
  // stopPropagation keeps the press from reaching the app's global shortcut
  // listeners (so recording ⌘P doesn't also open the palette) or the dialog's
  // own Escape-to-close handling.
  function onKeydown(e: KeyboardEvent): void {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      recording = false;
      return;
    }
    if (isModifierKey(e.key)) return;
    const hk: Hotkey = { key: normalizeHotkeyKey(e.key) };
    if (e.metaKey || e.ctrlKey) hk.mod = true;
    if (e.altKey) hk.alt = true;
    if (e.shiftKey) hk.shift = true;
    onChange(hk);
    recording = false;
  }
</script>

<button
  type="button"
  class={cn(
    'flex h-8 min-w-[7rem] items-center justify-center gap-1 rounded-md border px-2.5 text-sm transition-colors',
    recording
      ? 'border-primary ring-2 ring-primary/30'
      : conflict
        ? 'border-destructive text-destructive'
        : 'border-border hover:bg-muted/40',
  )}
  onclick={() => (recording = true)}
  onkeydown={onKeydown}
  onblur={() => (recording = false)}
>
  {#if recording}
    <span class="text-xs text-muted-foreground">Press a key…</span>
  {:else}
    {#each parts as part (part)}
      <Kbd>{part}</Kbd>
    {/each}
  {/if}
</button>
