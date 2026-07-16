<script lang="ts">
	import { DIFFS_TAG_NAME, FileDiff as FileDiffClass, parseDiffFromFile } from '@pierre/diffs';
	import type { ThemesType } from '@pierre/diffs';
	import { ensureDiffHighlighter } from '@super-review/ui/diff-highlighter';
	import { diffThemePair } from '@super-review/ui/diff-themes';
	import { applyIndentGuides, detectIndentStep } from '@super-review/ui/diff-indent-guides';
	import { app } from '@super-review/ui/store.svelte';
	import type { ViewMode } from '@super-review/core/types';

	interface Props {
		mode: ViewMode;
		// The `{ dark, light }` diff theme pair to render. Defaults to the app's
		// current selection; the settings grid passes a specific pair per option so
		// several themes can preview side by side.
		theme?: ThemesType;
		// Whether to paint indent guides over the preview. Defaults to the app's
		// current setting; the settings dialog passes its draft value so the
		// preview tracks the unsaved toggle.
		indentGuides?: boolean;
	}

	let { mode, theme, indentGuides }: Props = $props();

	const resolvedIndentGuides = $derived(indentGuides ?? app.indentGuides);

	const resolvedTheme = $derived(theme ?? diffThemePair(app.diffTheme));

	let host = $state<HTMLElement | null>(null);

	const OLD_CONTENTS = `export function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}
`;

	const NEW_CONTENTS = `export function total(items, taxRate = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal * (1 + taxRate);
}
`;

	const oldFile = { name: 'cart.ts', contents: OLD_CONTENTS };
	const newFile = { name: 'cart.ts', contents: NEW_CONTENTS };

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
		const guides = resolvedIndentGuides;
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
			lineDiffType: 'char',
			// Repaint the indent guides after each render (initial plain-text and
			// the highlighted rerender), matching the main diff view. Toggling the
			// setting rebuilds the whole preview, so off needs no clearing.
			onPostRender: () => {
				if (!guides || !container.shadowRoot) return;
				applyIndentGuides(container.shadowRoot, detectIndentStep(NEW_CONTENTS));
			}
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
		/* Default to the compact size; the previewable settings tabs override these
		   vars to render the shared preview larger. */
		font-size: var(--diff-preview-font-size, 10px);
		line-height: var(--diff-preview-line-height, 14px);
	}
</style>
