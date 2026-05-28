<script lang="ts">
  import { ArrowDown, ArrowUp, ArrowUpFromLine, Check, Loader2 } from 'lucide-svelte';
  import { Button } from './ui/button';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  let status = $derived(app.pushStatus);
  let busy = $derived(app.push.inProgress);
  let stage = $derived(app.push.stage);

  let label = $derived.by(() => {
    if (busy) {
      switch (stage) {
        case 'fetching':
          return 'Fetching';
        case 'pulling':
          return 'Pulling';
        case 'pushing':
          return 'Pushing';
        case 'conflicts':
          return 'Conflicts';
        default:
          return 'Working';
      }
    }
    if (!status?.hasUpstream) return 'Publish';
    if (status.behind > 0 && status.ahead > 0) return `Sync ${status.ahead}↑ ${status.behind}↓`;
    if (status.behind > 0) return `Pull ${status.behind}`;
    if (status.ahead > 0) return `Push ${status.ahead}`;
    return 'Up to date';
  });

  let title = $derived.by(() => {
    if (!status) return 'Push';
    const parts: string[] = [];
    if (status.branch) parts.push(`Branch: ${status.branch}`);
    parts.push(`Ahead ${status.ahead}, behind ${status.behind}`);
    if (!status.hasUpstream) parts.push('No upstream — will set on push');
    return parts.join(' · ');
  });

  let disabled = $derived.by(() => {
    if (busy) return true;
    if (!status?.hasRemote) return true;
    if (!status.hasUpstream) return false; // first push needs to work
    return status.ahead === 0 && status.behind === 0;
  });

  let Icon = $derived.by(() => {
    if (busy) return Loader2;
    if (!status?.hasUpstream) return ArrowUpFromLine;
    if (status.behind > 0 && status.ahead > 0) return ArrowUp;
    if (status.behind > 0) return ArrowDown;
    if (status.ahead > 0) return ArrowUp;
    return Check;
  });
</script>

{#if status?.hasRemote}
  <Button
    variant={status && (status.ahead > 0 || !status.hasUpstream) ? 'default' : 'ghost'}
    size="sm"
    {disabled}
    onclick={() => actions.push()}
    {title}
  >
    <Icon class={cn('size-3.5', busy && 'animate-spin')} />
    <span class="hidden text-xs sm:inline">{label}</span>
  </Button>
{/if}
