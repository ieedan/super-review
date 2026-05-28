<script lang="ts">
  import { Code2 } from 'lucide-svelte';
  import CursorIcon from './icons/CursorIcon.svelte';
  import VSCodeIcon from './icons/VSCodeIcon.svelte';
  import { Button } from './ui/button';
  import { actions, app, effectiveEditor } from '$lib/store.svelte';
  import type { EditorKind } from '@shared/types';

  let editor = $derived<EditorKind | null>(effectiveEditor());
  let anyAvailable = $derived(app.editors.cursor || app.editors.vscode);

  const editorLabels: Record<EditorKind, string> = {
    cursor: 'Cursor',
    vscode: 'Visual Studio Code',
  };

  async function openRepo(): Promise<void> {
    await actions.openInEditor();
  }
</script>

{#if anyAvailable}
  <Button
    variant="ghost"
    size="icon-sm"
    onclick={openRepo}
    title={editor ? `Open in ${editorLabels[editor]}` : 'Open in editor'}
  >
    {#if editor === 'cursor'}
      <CursorIcon class="size-4" />
    {:else if editor === 'vscode'}
      <VSCodeIcon class="size-4" />
    {:else}
      <Code2 class="size-4" />
    {/if}
  </Button>
{/if}
