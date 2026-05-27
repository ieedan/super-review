<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  type Variant = 'default' | 'secondary' | 'success' | 'destructive' | 'warning' | 'muted';

  interface Props {
    variant?: Variant;
    class?: string;
    children?: Snippet;
  }

  let { variant = 'default', class: className = '', children }: Props = $props();

  const variants: Record<Variant, string> = {
    default: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary text-secondary-foreground',
    success: 'bg-success/15 text-success',
    destructive: 'bg-destructive/15 text-destructive',
    warning: 'bg-warning/15 text-warning',
    muted: 'bg-muted text-muted-foreground',
  };
</script>

<span
  class={cn(
    'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums',
    variants[variant],
    className,
  )}
>
  {#if children}{@render children()}{/if}
</span>
