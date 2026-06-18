<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	// A selectable option card used throughout the settings panes: a radio-dot
	// header with a label, plus a body that's either a short text `hint` or
	// custom preview content passed as children. The selection ring is
	// intentionally instant (no transition) so it tracks clicks immediately.
	let {
		selected,
		label,
		onclick,
		hint,
		children,
		class: className
	}: {
		selected: boolean;
		label: string;
		onclick: () => void;
		// Standard muted body text. Mutually exclusive with `children`; when both
		// are given, `children` wins.
		hint?: string;
		// Custom body content (previews). Provides its own padding wrapper, since
		// each preview needs different spacing.
		children?: Snippet;
		class?: string;
	} = $props();
</script>

<button
	type="button"
	{onclick}
	class={cn(
		'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-none	',
		selected ? 'border-primary' : 'border-border hover:border-muted-foreground/50',
		className
	)}
>
	<div
		class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
	>
		<span
			class={cn(
				'grid size-3.5 shrink-0 place-items-center rounded-full border',
				selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
			)}
		>
			{#if selected}<Check class="size-2.5" />{/if}
		</span>
		{label}
	</div>
	{#if children}
		{@render children()}
	{:else if hint}
		<div class="w-full bg-background px-3 py-2 text-xs text-muted-foreground">{hint}</div>
	{/if}
</button>
