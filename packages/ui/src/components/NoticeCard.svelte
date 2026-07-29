<script lang="ts">
	// A single dismissible notice shown above the commit box: an optional logo, a
	// one-line message, an optional action, and (when `onDismiss` is given) a close
	// button. Purely presentational — `Stack` handles arranging several of these
	// into a Sonner-style stack. The background is a frosted translucent
	// card (`bg-card/75` + backdrop blur) so the diff/file list shows through
	// behind it, with a variant tint layered on top so cards read cleanly when
	// they overlap.
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Button } from './ui/button';

	type Variant = 'default' | 'warning' | 'destructive';

	let {
		variant = 'default',
		logo,
		children,
		action,
		onDismiss,
		dismissTitle = 'Dismiss',
		tooltip,
		multiline = false
	}: {
		variant?: Variant;
		/** Small brand/icon shown before the message. */
		logo?: Snippet;
		/** The message text (kept to a single truncated line). */
		children: Snippet;
		/**
		 * Let the message run to more than one line: drops the single-line clamp and
		 * gives the card the breathing room a stacked message needs. The lines
		 * themselves handle their own truncation.
		 */
		multiline?: boolean;
		/** Trailing action, e.g. a button. */
		action?: Snippet;
		/** When set, renders a × button that calls this. */
		onDismiss?: () => void;
		dismissTitle?: string;
		tooltip?: string;
	} = $props();

	const borderClass: Record<Variant, string> = {
		default: 'border-border',
		warning: 'border-warning/40',
		destructive: 'border-destructive/40'
	};
	const tintClass: Record<Variant, string> = {
		default: 'bg-muted/40',
		warning: 'bg-warning/10',
		destructive: 'bg-destructive/10'
	};
	const textClass: Record<Variant, string> = {
		default: 'text-muted-foreground',
		warning: 'text-warning',
		destructive: 'text-destructive'
	};
</script>

<div
	class={`relative flex items-center gap-2 overflow-hidden rounded-md border ${borderClass[variant]} bg-card/90 px-2 shadow-sm backdrop-blur-md ${multiline ? 'py-2' : 'py-1.5'}`}
	title={tooltip}
>
	<!-- Variant tint over the opaque card background. -->
	<div
		class={`pointer-events-none absolute inset-0 ${tintClass[variant]}`}
		aria-hidden="true"
	></div>

	{#if logo}
		<span class="relative z-10 flex shrink-0 items-center">{@render logo()}</span>
	{/if}
	<span
		class={`relative z-10 min-w-0 flex-1 text-[11px] ${multiline ? '' : 'truncate'} ${textClass[variant]}`}
	>
		{@render children()}
	</span>
	{#if action}
		<span class="relative z-10 shrink-0">{@render action()}</span>
	{/if}
	{#if onDismiss}
		<Button
			type="button"
			size="icon-xs"
			variant="ghost"
			class="relative z-10 size-6 shrink-0 text-muted-foreground"
			title={dismissTitle}
			onclick={onDismiss}
		>
			<X class="size-3.5" />
			<span class="sr-only">{dismissTitle}</span>
		</Button>
	{/if}
</div>
