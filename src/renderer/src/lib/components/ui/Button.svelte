<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type Variant = 'default' | 'secondary' | 'ghost' | 'outline' | 'destructive';
  type Size = 'sm' | 'md' | 'icon';

  interface Props extends Omit<HTMLButtonAttributes, 'class' | 'children'> {
    variant?: Variant;
    size?: Size;
    class?: string;
    children?: Snippet;
  }

  let {
    variant = 'default',
    size = 'md',
    class: className = '',
    children,
    ...rest
  }: Props = $props();

  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-1 ' +
    'focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';
  const variants: Record<Variant, string> = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    outline:
      'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };
  const sizes: Record<Size, string> = {
    sm: 'h-7 px-2.5 text-xs',
    md: 'h-8 px-3 text-sm',
    icon: 'h-8 w-8',
  };
</script>

<button class={cn(base, variants[variant], sizes[size], className)} {...rest}>
  {#if children}{@render children()}{/if}
</button>
