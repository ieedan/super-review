<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { WithElementRef } from 'bits-ui';
	import { cn } from '@super-review/ui/utils.js';

	type CellData = { char?: string | null; isActive: boolean; hasFakeCaret: boolean };

	let {
		ref = $bindable(null),
		class: className,
		cell,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { cell: CellData } = $props();
</script>

<div
	bind:this={ref}
	data-active={cell.isActive}
	class={cn(
		'border-input relative flex size-10 items-center justify-center border-y border-r text-sm font-semibold uppercase transition-all first:rounded-l-md first:border-l last:rounded-r-md data-[active=true]:z-10 data-[active=true]:ring-2 data-[active=true]:ring-ring',
		className
	)}
	{...restProps}
>
	{cell.char}
	{#if cell.hasFakeCaret}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			<div class="otp-caret bg-foreground h-5 w-px"></div>
		</div>
	{/if}
</div>

<style>
	.otp-caret {
		animation: otp-caret-blink 1s steps(1) infinite;
	}
	@keyframes otp-caret-blink {
		0%,
		70% {
			opacity: 1;
		}
		71%,
		100% {
			opacity: 0;
		}
	}
</style>
