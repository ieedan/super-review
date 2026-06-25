<script lang="ts">
	import MessageSquareText from '@lucide/svelte/icons/message-square-text';
	import { app } from '@super-review/ui/store.svelte';
	import { renderMarkdown } from '@super-review/ui/markdown';
	import '@super-review/ui/markdown.css';
	import type { SessionCallout } from '@super-review/core/types';

	// Inline agent callout, mounted by DiffFileSection at the start line of a
	// callout's range. Styled distinctly from review comments — this is the
	// agent narrating the code, not a review thread.
	let { callout }: { callout: SessionCallout } = $props();

	const rangeLabel = $derived(
		callout.startLine === callout.endLine
			? `Line ${callout.startLine}`
			: `Lines ${callout.startLine}–${callout.endLine}`
	);

	let html = $state('');
	$effect(() => {
		const src = callout.body;
		const theme = app.theme;
		if (!src.trim()) {
			html = '';
			return;
		}
		let cancelled = false;
		void renderMarkdown(src, theme)
			.then((h) => {
				if (!cancelled) html = h;
			})
			.catch(() => {
				if (!cancelled) html = '';
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<div
	class="my-1 mr-3 ml-2 rounded-md border border-l-2 border-primary/30 border-l-primary bg-primary/5 px-3 py-2"
>
	<div class="flex items-center gap-1.5 text-[11px] font-medium text-primary tabular-nums">
		<MessageSquareText class="size-3.5" />
		<span>{rangeLabel}</span>
		<span class="text-muted-foreground">· {callout.side === 'old' ? 'original' : 'new'}</span>
	</div>
	{#if html}
		<!-- html is sanitized with DOMPurify in markdown.ts (renderMarkdown) before it reaches here -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<div class="markdown-body mt-1.5 text-sm">{@html html}</div>
	{/if}
</div>
