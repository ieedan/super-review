<script lang="ts">
	// Renders a package.json as a real @pierre/diffs FileDiff and wires the same
	// token-hover → package-hover detection the desktop diff view uses
	// (DiffFileSection): parsePackageDeps builds the per-line dependency spans,
	// Pierre's onTokenEnter maps the hovered token to a span, and showPackageHover
	// opens the shared card. This is the actual diff renderer + actual hover path,
	// minus the app shell's staging/comments machinery.
	import {
		DIFFS_TAG_NAME,
		FileDiff as FileDiffClass,
		parseDiffFromFile,
		type ThemesType,
		type DiffTokenEventBaseProps
	} from '@pierre/diffs';
	import { ensureDiffHighlighter } from './diff-highlighter';
	import { diffThemePair } from './diff-themes';
	import { parsePackageDeps, spanAt, versionForName, type PackageDepIndex } from './package-json-deps';
	import { showPackageHover, scheduleHidePackageHover } from './package-hover.svelte';
	import type { ViewMode } from '@super-review/core/types';

	interface Props {
		// package.json contents on each side of the diff. Pass the same string for
		// both to show an unchanged file (still fully hoverable).
		oldContents: string;
		newContents: string;
		fileName?: string;
		mode?: ViewMode;
		theme?: ThemesType;
		themeType?: 'light' | 'dark';
	}

	let {
		oldContents,
		newContents,
		fileName = 'package.json',
		mode = 'unified',
		theme,
		themeType = 'dark'
	}: Props = $props();

	const resolvedTheme = $derived(theme ?? diffThemePair(undefined));

	let host = $state<HTMLElement | null>(null);

	// Per-side dependency indexes, rebuilt whenever the contents change. Plain
	// fields (not $state) — read synchronously inside the token handlers.
	let pkgDepsOld: PackageDepIndex | null = null;
	let pkgDepsNew: PackageDepIndex | null = null;

	// Mirrors DiffFileSection.onTokenEnter: map the hovered token to a dependency
	// span and open the card anchored to it; anything else dismisses.
	function onTokenEnter(props: DiffTokenEventBaseProps): void {
		const index = props.side === 'deletions' ? pkgDepsOld : pkgDepsNew;
		if (!index) return;
		const span = spanAt(index, props.lineNumber, props.lineCharStart, props.lineCharEnd);
		if (!span) {
			scheduleHidePackageHover();
			return;
		}
		showPackageHover(props.tokenElement, {
			kind: span.kind,
			name: span.name,
			version: span.version,
			oldRange: pkgDepsOld ? versionForName(pkgDepsOld, span.name) : null,
			newRange: pkgDepsNew ? versionForName(pkgDepsNew, span.name) : null
		});
	}

	$effect(() => {
		const diffStyle = mode;
		const themePair = resolvedTheme;
		const currentThemeType = themeType;
		const oldText = oldContents;
		const newText = newContents;
		if (!host) return;

		pkgDepsOld = parsePackageDeps(oldText);
		pkgDepsNew = parsePackageDeps(newText);

		const oldFile = { name: fileName, contents: oldText };
		const newFile = { name: fileName, contents: newText };

		const container = document.createElement(DIFFS_TAG_NAME);
		// eslint-disable-next-line svelte/no-dom-manipulating
		host.appendChild(container);

		const instance = new FileDiffClass({
			diffStyle,
			theme: themePair,
			themeType: currentThemeType,
			disableFileHeader: true,
			lineDiffType: 'char',
			onTokenEnter,
			onTokenLeave: scheduleHidePackageHover
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
				console.error('[PackageJsonDiff] render failed', err);
			}
		};

		paint();
		let disposed = false;
		void ensureDiffHighlighter().then(() => {
			if (disposed) return;
			try {
				instance.rerender();
			} catch (err) {
				console.error('[PackageJsonDiff] rerender failed', err);
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

<div bind:this={host} class="package-json-diff w-full"></div>

<style>
	.package-json-diff {
		display: block;
		width: 100%;
	}
	.package-json-diff :global(diffs-container) {
		display: block;
		width: 100%;
	}
</style>
