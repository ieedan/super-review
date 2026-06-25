<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';

	export const kbdVariants = tv({
		base: 'pointer-events-none inline-flex h-5 items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground select-none',
		variants: {
			variant: {
				default: '',
				outline: 'bg-transparent'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type KbdVariant = VariantProps<typeof kbdVariants>['variant'];
</script>

<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '@super-review/ui/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		variant?: KbdVariant;
	} = $props();
</script>

<kbd bind:this={ref} data-slot="kbd" class={cn(kbdVariants({ variant }), className)} {...restProps}>
	{@render children?.()}
</kbd>
