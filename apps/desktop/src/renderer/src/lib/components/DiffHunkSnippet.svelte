<script lang="ts">
	// Renders a GitHub-style snapshot of a comment's code context straight from
	// the stored unified-diff hunk (REST `diff_hunk`) — never the working tree. We
	// use this for outdated comments, whose anchored line (or whole file) no longer
	// exists in the current diff, so there's nothing on disk to render from.
	//
	// We render through @pierre/diffs (the same engine as the live diffs) so the
	// snippet gets real syntax highlighting and the app's diff theme instead of a
	// plain monospace block. Pierre diffs old-vs-new *contents* rather than a
	// patch, so we reconstruct both sides from the hunk's +/-/context lines and let
	// it re-derive the diff. Like DiffStylePreview, we render on the main thread
	// (the shared worker pool carries one global theme); the hunk is a handful of
	// lines, so highlighting it inline is cheap.

	import { DIFFS_TAG_NAME, FileDiff as FileDiffClass, parseDiffFromFile } from '@pierre/diffs';
	import { ensureDiffHighlighter } from '$lib/diff-highlighter';
	import { diffThemePair } from '$lib/diff-themes';
	import { app } from '$lib/store.svelte';

	interface Props {
		// The unified-diff hunk text, e.g.
		//   "@@ -10,7 +10,6 @@ fn foo()\n context\n-removed\n+added".
		hunk: string;
		// The comment's file path, used to pick the syntax-highlighting grammar.
		path: string;
	}

	let { hunk, path }: Props = $props();

	// Rebuild the two sides of the hunk: context lines belong to both, `-` lines to
	// the old side only, `+` lines to the new side only. Pierre re-derives the diff
	// from these, so the +/- coloring (and the changed line the comment points at)
	// comes back out without us tracking line numbers by hand.
	const sides = $derived.by<{ oldContents: string; newContents: string }>(() => {
		const oldLines: string[] = [];
		const newLines: string[] = [];
		for (const line of hunk.split('\n')) {
			if (line === '' || line.startsWith('@@')) continue;
			const marker = line[0];
			const text = line.slice(1);
			if (marker === '+') {
				newLines.push(text);
			} else if (marker === '-') {
				oldLines.push(text);
			} else if (marker === '\\') {
				// "\ No newline at end of file" — metadata, not a code line.
				continue;
			} else {
				oldLines.push(text);
				newLines.push(text);
			}
		}
		// Terminate with a trailing newline so Pierre doesn't render a "No newline at
		// end of file" marker on the last line.
		return {
			oldContents: oldLines.length ? oldLines.join('\n') + '\n' : '',
			newContents: newLines.length ? newLines.join('\n') + '\n' : ''
		};
	});

	let host = $state<HTMLElement | null>(null);

	$effect(() => {
		const { oldContents, newContents } = sides;
		const themePair = diffThemePair(app.diffTheme);
		const themeType = app.theme;
		if (!host) return;

		const oldFile = { name: path, contents: oldContents };
		const newFile = { name: path, contents: newContents };

		const container = document.createElement(DIFFS_TAG_NAME);
		// `host` is ours and Svelte doesn't manage its children — Pierre renders
		// into this element, so the manual append is intentional.
		// eslint-disable-next-line svelte/no-dom-manipulating
		host.appendChild(container);

		const instance = new FileDiffClass({
			diffStyle: 'unified',
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
				console.error('[DiffHunkSnippet] render failed', err);
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
				console.error('[DiffHunkSnippet] rerender failed', err);
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

<div bind:this={host} class="hunk-snippet"></div>

<style>
	.hunk-snippet {
		display: block;
		width: 100%;
		overflow: hidden;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		/* Same as the main diff host: Pierre's scroll element otherwise reserves a
		   bottom strip (always-on `overflow: scroll` + `scrollbar-gutter: stable`),
		   which shows as a dark bar under the snippet. Only scroll/reserve on actual
		   overflow. */
		--diffs-overflow-override: auto;
	}
	.hunk-snippet :global(diffs-container) {
		display: block;
		width: 100%;
	}
	.hunk-snippet :global(pre) {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
	}
	.hunk-snippet :global([data-code]) {
		scrollbar-gutter: auto;
		padding-bottom: 0;
	}
</style>
