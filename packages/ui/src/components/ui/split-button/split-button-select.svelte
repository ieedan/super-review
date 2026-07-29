<script lang="ts" module>
	import type { WithoutChild } from '@super-review/ui/utils.js';
	import type { Select as SelectPrimitiveNs } from 'bits-ui';

	export type SplitButtonSelectProps = Omit<
		WithoutChild<SelectPrimitiveNs.RootProps>,
		'type' | 'value' | 'onValueChange'
	>;
</script>

<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { useSplitButtonRootCtx } from './split-button.svelte.js';

	let { open = $bindable(false), children, ...restProps }: SplitButtonSelectProps = $props();

	const root = useSplitButtonRootCtx();
</script>

<SelectPrimitive.Root
	type="single"
	bind:open
	bind:value={root.action}
	onValueChange={(v) => root.onSelect(v)}
	{...restProps}
>
	{@render children?.()}
</SelectPrimitive.Root>
