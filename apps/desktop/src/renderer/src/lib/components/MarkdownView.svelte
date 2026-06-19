<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';
	import { app } from '$lib/store.svelte';

	// Renders a markdown string as sanitized GitHub-Flavored-Markdown HTML, tracking
	// the app theme so code blocks match light/dark. A thin reactive wrapper over
	// `renderMarkdown` so any surface (conversation items, etc.) can drop in a
	// formatted body without re-implementing the async render + cancellation dance.
	interface Props {
		src: string;
		// Extra classes for the `.markdown-body` container (e.g. text sizing).
		class?: string;
	}

	let { src, class: className = '' }: Props = $props();

	let html = $state('');
	$effect(() => {
		const source = src;
		const theme = app.theme;
		if (!source.trim()) {
			html = '';
			return;
		}
		let cancelled = false;
		void renderMarkdown(source, theme)
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

<!-- html is sanitized with DOMPurify in markdown.ts (renderMarkdown) before it reaches here -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class={['markdown-body', className]}>{@html html}</div>
