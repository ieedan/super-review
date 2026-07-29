<script lang="ts" module>
	import type { WithoutChild } from '@super-review/ui/utils.js';
	import type { Select as SelectPrimitiveNs } from 'bits-ui';
	import type { ButtonSize, ButtonVariant } from '../button/button.svelte';

	export type SplitButtonSelectTriggerProps = WithoutChild<SelectPrimitiveNs.TriggerProps> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
	};
</script>

<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { cn } from '@super-review/ui/utils.js';
	import { buttonVariants } from '../button/button.svelte';
	import { useSplitButtonRootCtx } from './split-button.svelte.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		size = 'icon',
		disabled,
		children,
		...restProps
	}: SplitButtonSelectTriggerProps = $props();

	const root = useSplitButtonRootCtx();
</script>

<SelectPrimitive.Trigger
	bind:ref
	data-slot="split-button-select-trigger"
	disabled={disabled || root.disabled}
	class={cn(buttonVariants({ variant, size }), className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		<ChevronDownIcon />
	{/if}
</SelectPrimitive.Trigger>
