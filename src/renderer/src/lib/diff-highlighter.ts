// Single shared @pierre/diffs highlighter for the whole app. Following the
// shiki best-practice: one highlighter instance keeps WASM/JS regex + theme
// state cached across every diff render.
//
// Call `initDiffHighlighter()` once at boot. Subsequent calls are a no-op.
// Components that render diffs can `await ensureDiffHighlighter()` if they
// want to guarantee the highlighter is ready (the FileDiff render call also
// triggers an async load + rerender on its own, so awaiting is optional).

import {
  DEFAULT_THEMES,
  isHighlighterLoaded,
  getHighlighterIfLoaded,
  preloadHighlighter,
} from '@pierre/diffs';

let preloadPromise: Promise<void> | null = null;

export function ensureDiffHighlighter(): Promise<void> {
  if (isHighlighterLoaded(getHighlighterIfLoaded())) return Promise.resolve();
  if (!preloadPromise) {
    console.log('[diff-highlighter] preload start');
    preloadPromise = preloadHighlighter({
      themes: [DEFAULT_THEMES.dark, DEFAULT_THEMES.light],
      langs: ['javascript', 'typescript', 'tsx', 'jsx', 'json', 'css', 'html'],
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
