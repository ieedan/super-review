<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { DIFFS_TAG_NAME, FileDiff as FileDiffClass, parseDiffFromFile } from '@pierre/diffs';
	import { ensureDiffHighlighter } from '$lib/diff-highlighter';
	import { getDiffWorkerPool } from '$lib/diff-worker-pool';
	import { app } from '$lib/store.svelte';
	import type { ViewMode } from '@shared/types';

	interface Props {
		mode: ViewMode;
	}

	let { mode }: Props = $props();

	let host = $state<HTMLElement | null>(null);
	let container: HTMLElement | null = null;
	let instance: FileDiffClass | null = null;

	const OLD_CONTENTS = `function greet(name) {
  return 'Hello, ' + name;
}
`;

	const NEW_CONTENTS = `function greet(name) {
  return \`Hello, \${name}!\`;
}
`;

	const oldFile = { name: 'greet.js', contents: OLD_CONTENTS };
	const newFile = { name: 'greet.js', contents: NEW_CONTENTS };

	function dispose(): void {
		if (instance) {
			try {
				instance.cleanUp();
			} catch {
				// ignore
			}
			instance = null;
		}
		if (container) {
			container.remove();
			container = null;
		}
	}

	function render(): void {
		if (!host || !instance || !container) return;
		const metadata = parseDiffFromFile(oldFile, newFile);
		console.log('[DiffStylePreview] render', mode, 'metadata?', !!metadata);
		if (!metadata) return;
		try {
			const result = instance.render({
				fileContainer: container,
				fileDiff: metadata,
				oldFile,
				newFile,
				lineAnnotations: [],
				forceRender: true
			});
			console.log(
				'[DiffStylePreview] render returned',
				result,
				'shadowChildren?',
				container.shadowRoot?.childNodes.length
			);
		} catch (err) {
			console.error('[DiffStylePreview] render failed', err);
		}
	}

	onMount(() => {
		if (!host) return;
		container = document.createElement(DIFFS_TAG_NAME);
		// `host` is ours and Svelte doesn't manage its children — Pierre renders
		// into this element, so the manual append is intentional.
		// eslint-disable-next-line svelte/no-dom-manipulating
		host.appendChild(container);
		instance = new FileDiffClass(
			{
				diffStyle: mode,
				themeType: app.theme,
				disableFileHeader: true
			},
			// Share the app-wide worker pool so even this small settings preview
			// highlights off the main thread (and stays consistent with real diffs).
			getDiffWorkerPool()
		);
		// First paint — fires synchronously. If shiki isn't loaded yet, the diff
		// renders without highlighting and the library schedules its own rerender
		// when shiki resolves.
		render();
		// Belt and suspenders: when our shared highlighter promise resolves,
		// explicitly rerender so the highlighted version replaces the plain one.
		void ensureDiffHighlighter().then(() => {
			if (!instance) return;
			console.log('[DiffStylePreview] highlighter ready — rerender', mode);
			try {
				instance.rerender();
				console.log(
					'[DiffStylePreview] post-rerender shadowChildren?',
					container?.shadowRoot?.childNodes.length
				);
			} catch (err) {
				console.error('[DiffStylePreview] rerender failed', err);
			}
		});
	});

	onDestroy(dispose);
</script>

<div bind:this={host} class="diff-style-preview w-full"></div>

<style>
	.diff-style-preview {
		display: block;
		width: 100%;
	}
	.diff-style-preview :global(diffs-container) {
		display: block;
		width: 100%;
		min-height: 60px;
	}
	.diff-style-preview :global(pre) {
		margin: 0;
		font-size: 10px;
		line-height: 14px;
	}
</style>
