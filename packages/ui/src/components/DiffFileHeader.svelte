<script lang="ts">
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Code from '@lucide/svelte/icons/code';
	import Code2 from '@lucide/svelte/icons/code-2';
	import Eye from '@lucide/svelte/icons/eye';
	import FileEdit from '@lucide/svelte/icons/file-edit';
	import FileMinus from '@lucide/svelte/icons/file-minus';
	import FileText from '@lucide/svelte/icons/file-text';
	import ImageIcon from '@lucide/svelte/icons/image';
	import CursorIcon from './icons/CursorIcon.svelte';
	import VSCodeIcon from './icons/VSCodeIcon.svelte';
	import XcodeIcon from './icons/XcodeIcon.svelte';
	import ZedIcon from './icons/ZedIcon.svelte';
	import VisualStudioIcon from './icons/VisualStudioIcon.svelte';
	import FileIcon from './FileIcon.svelte';
	import { truncatePathPrefix } from '@super-review/ui/path-truncate';
	import { Button } from './ui/button';
	import { Badge } from './ui/badge';
	import { ShortcutHint } from './ui/shortcut-hint';
	import { app, effectiveEditor } from '@super-review/ui/store.svelte';
	import type { EditorKind } from '@super-review/core/types';

	interface Props {
		path: string;
		expanded: boolean;
		onToggleExpanded?: () => void;
		// Sticky for the main scrollable diff list; false in the settings preview.
		sticky?: boolean;
		// When false, chrome stays visible for parity but clicks are no-ops and the
		// context menu is not wired.
		interactive?: boolean;
		isSeen?: boolean;
		statusBadge?: 'deleted' | 'renamed' | null;
		commentCount?: number;
		showCommentCount?: boolean;
		additions?: number;
		deletions?: number;
		isBinary?: boolean;
		showViewToggle?: boolean;
		showRaw?: boolean;
		onShowRawChange?: (raw: boolean) => void;
		onPrimeRaw?: () => void;
		canPreview?: boolean;
		showPreview?: boolean;
		isSvg?: boolean;
		onTogglePreview?: () => void;
		onOpenEditor?: () => void;
		markSeenHotkey?: string[];
		onMarkSeen?: () => void;
		onContextMenu?: (e: MouseEvent) => void;
	}

	let {
		path,
		expanded,
		onToggleExpanded,
		sticky = true,
		interactive = true,
		isSeen = false,
		statusBadge = null,
		commentCount = 0,
		showCommentCount = false,
		additions = 0,
		deletions = 0,
		isBinary = false,
		showViewToggle = false,
		showRaw = false,
		onShowRawChange,
		onPrimeRaw,
		canPreview = false,
		showPreview = false,
		isSvg = false,
		onTogglePreview,
		onOpenEditor,
		markSeenHotkey = [],
		onMarkSeen,
		onContextMenu
	}: Props = $props();

	const pathDir = $derived(path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');
	const pathBase = $derived(path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path);

	// Center-style path truncation matching the sidebar changes list: keep the full
	// filename and shrink only the directory prefix.
	let pathEl = $state<HTMLElement | null>(null);
	let pathWidth = $state(0);
	let pathFont = $state('12px ui-monospace, monospace');
	onMount(() => {
		const el = pathEl;
		if (!el) return;
		const cs = window.getComputedStyle(el);
		pathFont = `${cs.fontWeight} 12px ${cs.fontFamily}`;
		pathWidth = el.clientWidth;
		const ro = new ResizeObserver(() => {
			pathWidth = el.clientWidth;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});
	const displayPrefix = $derived(
		pathDir ? truncatePathPrefix(pathDir, pathBase, pathWidth, pathFont) : ''
	);

	const editor = $derived<EditorKind | null>(effectiveEditor());
	const anyEditorAvailable = $derived(
		app.editors.cursor ||
			app.editors.vscode ||
			app.editors.zed ||
			app.editors.xcode ||
			app.editors.visualstudio
	);
	const editorLabels: Record<EditorKind, string> = {
		cursor: 'Cursor',
		vscode: 'Visual Studio Code',
		zed: 'Zed',
		xcode: 'Xcode',
		visualstudio: 'Visual Studio'
	};

	function handleContextMenu(e: MouseEvent): void {
		if (!interactive || !onContextMenu) return;
		onContextMenu(e);
	}

	function handleToggleExpanded(): void {
		if (!interactive) return;
		onToggleExpanded?.();
	}

	function handleOpenEditor(): void {
		if (!interactive) return;
		onOpenEditor?.();
	}

	function handleTogglePreview(): void {
		if (!interactive) return;
		onTogglePreview?.();
	}

	function handleShowRawChange(raw: boolean): void {
		if (!interactive) return;
		onShowRawChange?.(raw);
	}

	function handleMarkSeen(): void {
		if (!interactive) return;
		onMarkSeen?.();
	}

	function handlePrimeRaw(): void {
		if (!interactive) return;
		onPrimeRaw?.();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- The header is a structural row, not a control; the contextmenu handler is
     a supplementary right-click affordance for customizing the file header. -->
<header
	class={[
		'@container flex h-11 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur',
		// -top-px, not top-0: backdrop-blur puts the stuck header on its own
		// compositor layer, which snaps to whole pixels while the diff behind it
		// scrolls at fractional offsets, so a 1px sliver of code used to bleed
		// through above it. Sticking it 1px into the scroll container's clipped
		// area covers that seam. `top` only applies while stuck, so unstuck
		// headers still sit flush under the previous file's bottom border.
		sticky && 'sticky -top-px z-10'
	]}
	oncontextmenu={handleContextMenu}
>
	<!-- The visible chevron stays size-5, but a transparent ::before stretches the
	     click target to the header's top/bottom edges, out to the left edge
	     (through px-3) and into the gap toward the icon — easier to hit. -->
	<button
		type="button"
		class="relative grid size-5 shrink-0 place-items-center rounded hover:bg-accent before:absolute before:-inset-y-3 before:-left-3 before:-right-2 before:content-['']"
		onclick={handleToggleExpanded}
		aria-label={expanded ? 'Collapse' : 'Expand'}
		tabindex={interactive ? undefined : -1}
	>
		{#if expanded}
			<ChevronDown class="size-3.5" />
		{:else}
			<ChevronRight class="size-3.5" />
		{/if}
	</button>
	<FileIcon {path} class="size-3.5 shrink-0" />
	<div class="flex min-w-0 flex-1 items-center gap-2">
		<!-- Inline whitespace is intentional (see FileList.svelte): a newline
		     between these flex children renders as a visible gap between the
		     truncated prefix and the filename. `displayPrefix` is pre-fit by
		     pretext, so the label only needs overflow-hidden as a guard. -->
		<span
			bind:this={pathEl}
			class={[
				'flex min-w-0 flex-1 items-center overflow-hidden text-xs whitespace-nowrap',
				isSeen && 'text-muted-foreground'
			]}
			title={path}
			>{#if displayPrefix}<span class={[!isSeen && 'text-muted-foreground']}>{displayPrefix}</span
				>{/if}<span class="shrink-0">{pathBase}</span></span
		>
		{#if statusBadge === 'deleted'}
			<span class="flex shrink-0 items-center" title="Deleted">
				<FileMinus class="size-3.5 text-destructive" />
			</span>
		{:else if statusBadge === 'renamed'}
			<span class="flex shrink-0 items-center" title="Renamed">
				<FileEdit class="size-3.5 text-warning" />
			</span>
		{/if}
		{#if isBinary}
			<Badge variant="muted" class="@max-[440px]:hidden">binary</Badge>
		{/if}
		{#if showCommentCount && commentCount > 0}
			<Badge variant="muted" class="@max-[440px]:hidden">
				{commentCount} comment{commentCount === 1 ? '' : 's'}
			</Badge>
		{/if}
	</div>
	<div class="flex items-center gap-2 text-[10px] tabular-nums">
		{#if !isBinary && app.fileHeaderItems.changedLines}
			{#if additions > 0}
				<span class="text-success @max-[360px]:hidden">+{additions}</span>
			{/if}
			{#if deletions > 0}
				<span class="text-destructive @max-[360px]:hidden">−{deletions}</span>
			{/if}
		{/if}
		{#if anyEditorAvailable && app.fileHeaderItems.editor}
			<!-- As the diff pane gets cramped (e.g. comments panel open), elements
			     drop right-to-left so the file name keeps its room, widest first:
			     Mark seen (<500, ⌘↵ still works) → badges (<440) → the Raw/Diff
			     toggle (<460) → this editor button (<400) → the +/- counts (<360). -->
			<Button
				variant="ghost"
				size="icon-sm"
				class="@max-[400px]:hidden"
				onclick={handleOpenEditor}
				title={editor ? `Open in ${editorLabels[editor]}` : 'Open in editor'}
				tabindex={interactive ? undefined : -1}
			>
				{#if editor === 'cursor'}
					<CursorIcon class="size-3.5" />
				{:else if editor === 'vscode'}
					<VSCodeIcon class="size-3.5" />
				{:else if editor === 'zed'}
					<ZedIcon class="size-3.5" />
				{:else if editor === 'xcode'}
					<XcodeIcon class="size-3.5" />
				{:else if editor === 'visualstudio'}
					<VisualStudioIcon class="size-3.5" />
				{:else}
					<Code2 class="size-3.5" />
				{/if}
			</Button>
		{/if}
		{#if canPreview}
			<Button
				variant={showPreview ? 'secondary' : 'outline'}
				size="sm"
				onclick={handleTogglePreview}
				tabindex={interactive ? undefined : -1}
			>
				{#if showPreview}
					<Code class="size-3.5" /> Code
				{:else if isSvg}
					<ImageIcon class="size-3.5" /> Image
				{:else}
					<FileText class="size-3.5" /> Preview
				{/if}
			</Button>
		{/if}
		<!-- Diff/Raw view switcher: a two-segment toggle between the diff and the
		     whole file. A bordered track (no fill) with the selected segment
		     filled. Drops out below 460px (after Mark seen) to keep the filename
		     room when the pane is cramped. -->
		{#if showViewToggle && app.fileHeaderItems.viewToggle}
			<div
				class="inline-flex h-7 items-stretch gap-0.5 rounded-md border border-border p-0.5 @max-[460px]:hidden"
				role="group"
				aria-label="View mode"
				onpointerenter={handlePrimeRaw}
			>
				{#each [{ raw: false, label: 'Diff' }, { raw: true, label: 'Raw' }] as opt (opt.label)}
					{@const active = showRaw === opt.raw}
					<button
						type="button"
						aria-pressed={active}
						onclick={() => handleShowRawChange(opt.raw)}
						tabindex={interactive ? undefined : -1}
						class={[
							'flex items-center rounded-sm px-2 text-[0.8rem] font-medium transition-colors',
							active
								? 'bg-secondary text-secondary-foreground'
								: 'text-muted-foreground hover:text-foreground'
						]}
					>
						{opt.label}
					</button>
				{/each}
			</div>
		{/if}
		{#if app.fileHeaderItems.markSeen}
			<Button
				variant={isSeen ? 'secondary' : 'outline'}
				size="sm"
				class="@max-[500px]:hidden"
				onclick={handleMarkSeen}
				tabindex={interactive ? undefined : -1}
			>
				{#if isSeen}
					<Check class="size-3.5" /> Seen
				{:else}
					<Eye class="size-3.5" /> Mark seen
					{#if markSeenHotkey.length > 0}
						<ShortcutHint>{markSeenHotkey.join('')}</ShortcutHint>
					{/if}
				{/if}
			</Button>
		{/if}
	</div>
</header>
