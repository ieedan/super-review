<script lang="ts">
	import { DIFFS_TAG_NAME, FileDiff as FileDiffClass, parseDiffFromFile } from '@pierre/diffs';
	import type { ThemesType } from '@pierre/diffs';
	import { ensureDiffHighlighter } from '$lib/diff-highlighter';
	import { diffThemePair } from '$lib/diff-themes';
	import { app } from '$lib/store.svelte';
	import type { ViewMode } from '@shared/types';

	interface Props {
		mode: ViewMode;
		// The `{ dark, light }` diff theme pair to render. Defaults to the app's
		// current selection; the settings grid passes a specific pair per option so
		// several themes can preview side by side.
		theme?: ThemesType;
	}

	let { mode, theme }: Props = $props();

	const resolvedTheme = $derived(theme ?? diffThemePair(app.diffTheme));

	let host = $state<HTMLElement | null>(null);

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

	// Rebuild the preview whenever the style, theme, or app light/dark mode
	// changes. Unlike the live diffs, the preview renders WITHOUT the shared
	// worker pool: the pool carries a single global theme, so pooled previews
	// would all collapse onto whichever theme was set last. Rendering each on the
	// main thread (a few lines of JS) lets every option show its own theme at
	// once. The shared highlighter is preloaded with all preset themes; until it
	// resolves the diff paints plain text, then we rerender highlighted.
	$effect(() => {
		const diffStyle = mode;
		const themePair = resolvedTheme;
		const themeType = app.theme;
		if (!host) return;

		const container = document.createElement(DIFFS_TAG_NAME);
		// `host` is ours and Svelte doesn't manage its children — Pierre renders
		// into this element, so the manual append is intentional.
		// eslint-disable-next-line svelte/no-dom-manipulating
		host.appendChild(container);

		const instance = new FileDiffClass({
			diffStyle,
			theme: themePair,
			themeType,
			disableFileHeader: true,
			// Character-level intra-line diffs, matching the main diff view.
			lineDiffType: 'char'
		});

		const paint = (): void => {
			const metadata = parseDiffFromFile(oldFile, newFile);
			if (!metadata) return;
			try {
				instance.render({
					fileContainer: container,
					fileDiff: metadata,
					oldFile,
					newFile,
					lineAnnotations: [],
					forceRender: true
				});
			} catch (err) {
				console.error('[DiffStylePreview] render failed', err);
			}
		};

		// First paint (synchronous, possibly unhighlighted), then rerender once the
		// highlighter has the themes loaded.
		paint();
		let disposed = false;
		void ensureDiffHighlighter().then(() => {
			if (disposed) return;
			try {
				instance.rerender();
			} catch (err) {
				console.error('[DiffStylePreview] rerender failed', err);
			}
		});

		return () => {
			disposed = true;
			try {
				instance.cleanUp();
			} catch {
				// ignore
			}
			container.remove();
		};
	});
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
