<script lang="ts">
	import { renderMarkdown, toggleTaskListItem } from '@super-review/ui/markdown';
	import { app } from '@super-review/ui/store.svelte';

	// Renders a markdown string as sanitized GitHub-Flavored-Markdown HTML, tracking
	// the app theme so code blocks match light/dark. A thin reactive wrapper over
	// `renderMarkdown` so any surface (conversation items, etc.) can drop in a
	// formatted body without re-implementing the async render + cancellation dance.
	//
	// When `onToggleTask` is provided, GFM task-list checkboxes (`- [ ]`) become
	// interactive: clicking one computes the rewritten markdown (the Nth checkbox
	// flipped) and hands it back so the caller can persist it. Without the callback
	// the checkboxes stay disabled, exactly as GitHub renders them for read-only
	// viewers.
	interface Props {
		src: string;
		// Extra classes for the `.markdown-body` container (e.g. text sizing).
		class?: string;
		onToggleTask?: (newSrc: string) => void;
	}

	let { src, class: className = '', onToggleTask }: Props = $props();

	let html = $state('');
	let container = $state<HTMLElement | null>(null);

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

	// After each render, enable (or re-disable) the task-list checkboxes and tag
	// each with its document index so a change can be mapped back to the source.
	$effect(() => {
		void html; // re-run when the rendered HTML changes
		if (!container) return;
		const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
		boxes.forEach((box, i) => {
			box.disabled = !onToggleTask;
			box.dataset.taskIndex = String(i);
			if (onToggleTask) box.classList.add('cursor-pointer');
		});
	});

	function onChange(e: Event): void {
		if (!onToggleTask) return;
		const target = e.target;
		if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
		const index = Number(target.dataset.taskIndex);
		if (Number.isNaN(index)) return;
		onToggleTask(toggleTaskListItem(src, index, target.checked));
	}
</script>

<!-- html is sanitized with DOMPurify in markdown.ts (renderMarkdown) before it reaches here -->
<div bind:this={container} class={['markdown-body', className]} onchange={onChange}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>
