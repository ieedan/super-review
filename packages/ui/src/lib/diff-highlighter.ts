// Single shared @pierre/diffs highlighter for the whole app. Following the
// shiki best-practice: one highlighter instance keeps WASM/JS regex + theme
// state cached across every diff render.
//
// Call `initDiffHighlighter()` once at boot. Subsequent calls are a no-op.
// Components that render diffs can `await ensureDiffHighlighter()` if they
// want to guarantee the highlighter is ready (the FileDiff render call also
// triggers an async load + rerender on its own, so awaiting is optional).

import { isHighlighterLoaded, getHighlighterIfLoaded, preloadHighlighter } from '@pierre/diffs';
import { ALL_DIFF_THEME_NAMES } from './diff-themes';

let preloadPromise: Promise<void> | null = null;

export function ensureDiffHighlighter(): Promise<void> {
	if (isHighlighterLoaded(getHighlighterIfLoaded())) return Promise.resolve();
	if (!preloadPromise) {
		console.log('[diff-highlighter] preload start');
		// Warm every selectable diff theme (both light/dark variants of all
		// presets), not just the default pair: the settings previews render each
		// theme at once on the main thread, and any of them can become the live
		// diff theme. Themes are cheap JSON next to the grammars/regex engine.
		preloadPromise = preloadHighlighter({
			themes: ALL_DIFF_THEME_NAMES,
			langs: ['javascript', 'typescript', 'tsx', 'jsx', 'json', 'css', 'html']
		})
			.then(() => {
				console.log('[diff-highlighter] preload complete');
			})
			.catch((err) => {
				console.error('[diff-highlighter] preload failed:', err);
			});
	}
	return preloadPromise;
}

export function initDiffHighlighter(): void {
	void ensureDiffHighlighter();
}
