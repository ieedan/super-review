<script lang="ts">
	import { app } from '$lib/store.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import '$lib/markdown.css';

	// A tour step's intro, rendered above its group of file diffs: the step
	// number + title, and its Markdown commentary. `index` is 0 for the synthetic
	// "Other changes" group, which shows no number.
	let {
		id,
		title,
		body,
		index,
		total
	}: {
		id: string;
		title: string;
		body: string;
		index: number;
		total: number;
	} = $props();

	let html = $state('');
	$effect(() => {
		const src = body;
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

<div data-step-id={id} class="scroll-mt-0 border-b border-border bg-muted/30 px-4 py-3.5">
	<div class="flex items-baseline gap-2">
		{#if index > 0}
			<span class="text-xs font-semibold text-muted-foreground tabular-nums" aria-hidden="true">
				{index}/{total}
			</span>
		{/if}
		<h2 class="text-[15px] leading-tight font-semibold">{title}</h2>
	</div>
	{#if html}
		<!-- html is sanitized with DOMPurify in markdown.ts (renderMarkdown) before it reaches here -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<div class="markdown-body mt-2 max-w-3xl text-sm">{@html html}</div>
	{/if}
</div>
