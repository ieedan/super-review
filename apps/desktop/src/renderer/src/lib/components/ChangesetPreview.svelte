<script lang="ts">
	// Live preview of the changeset file being authored, rendered with @pierre/diffs
	// as an all-added diff (old side empty → every line shows green/added), so the
	// dialog feels like watching the file get written. Mirrors the standalone-render
	// pattern in DiffStylePreview.svelte (main thread, no worker pool, no scheduler).
	import { DIFFS_TAG_NAME, FileDiff as FileDiffClass, parseDiffFromFile } from '@pierre/diffs';
	import { ensureDiffHighlighter } from '$lib/diff-highlighter';
	import { diffThemePair } from '$lib/diff-themes';
	import { app } from '$lib/store.svelte';

	let { filename, content }: { filename: string; content: string } = $props();

	let host = $state<HTMLElement | null>(null);
	// $state so the paint effect re-runs once these exist. `new FileDiff({...})`
	// infers `FileDiff<undefined>` (no annotations), so type the state to match.
	let instance = $state<FileDiffClass<undefined> | null>(null);
	let container = $state<HTMLElement | null>(null);

	// Create the Pierre instance once per host / theme. Rebuilds on a light↔dark
	// switch (cheap; the file is tiny) so the diff repaints in the new theme.
	$effect(() => {
		const themePair = diffThemePair(app.diffTheme);
		const themeType = app.theme;
		if (!host) return;

		const el = document.createElement(DIFFS_TAG_NAME);
		// Pierre owns this element's children; Svelte doesn't manage them.
		// eslint-disable-next-line svelte/no-dom-manipulating
		host.appendChild(el);

		const inst = new FileDiffClass({
			diffStyle: 'unified',
			theme: themePair,
			themeType,
			disableFileHeader: true,
			lineDiffType: 'char'
		});
		instance = inst;
		container = el;

		let disposed = false;
		void ensureDiffHighlighter().then(() => {
			if (disposed) return;
			try {
				inst.rerender();
			} catch {
				// ignore
			}
		});

		return () => {
			disposed = true;
			instance = null;
			container = null;
			try {
				inst.cleanUp();
			} catch {
				// ignore
			}
			el.remove();
		};
	});

	// Repaint whenever the authored content (or filename) changes. Reuses the same
	// instance/container so typing doesn't tear down and recreate the renderer.
	$effect(() => {
		const inst = instance;
		const el = container;
		const text = content;
		const fname = filename;
		if (!inst || !el) return;
		const oldFile = { name: fname, contents: '' };
		const newFile = { name: fname, contents: text };
		const metadata = parseDiffFromFile(oldFile, newFile);
		if (!metadata) return;
		try {
			inst.render({
				fileContainer: el,
				fileDiff: metadata,
				oldFile,
				newFile,
				lineAnnotations: [],
				forceRender: true
			});
		} catch (err) {
			console.error('[ChangesetPreview] render failed', err);
		}
	});
</script>

<div bind:this={host} class="changeset-preview w-full"></div>

<style>
	.changeset-preview {
		display: block;
		width: 100%;
	}
	.changeset-preview :global(diffs-container) {
		display: block;
		width: 100%;
	}
	.changeset-preview :global(pre) {
		margin: 0;
		font-size: 11px;
		line-height: 16px;
	}
</style>
