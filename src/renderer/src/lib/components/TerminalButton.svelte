<script lang="ts">
  import { SquareTerminal } from 'lucide-svelte';
  import { Button } from './ui/button';
  import GhostIcon from './icons/GhostIcon.svelte';
  import { actions, app, effectiveTerminal } from '$lib/store.svelte';
  import type { TerminalKind } from '@shared/types';

  let terminal = $derived<TerminalKind | null>(effectiveTerminal());
  let anyAvailable = $derived(
    app.terminals.terminal ||
      app.terminals.iterm ||
      app.terminals.warp ||
      app.terminals.ghostty,
  );

  const terminalLabels: Record<TerminalKind, string> = {
    terminal: 'Terminal',
    iterm: 'iTerm',
    warp: 'Warp',
    ghostty: 'Ghostty',
  };

  async function openRepo(): Promise<void> {
    await actions.openInTerminal();
  }
</script>

{#if anyAvailable}
  <Button
    variant="ghost"
    size="icon-sm"
    onclick={openRepo}
    title={terminal ? `Open in ${terminalLabels[terminal]}` : 'Open in terminal'}
  >
    {#if terminal === 'ghostty'}
      <GhostIcon class="size-4" />
    {:else}
      <SquareTerminal class="size-4" />
    {/if}
  </Button>
{/if}
