<script lang="ts">
	// Combined live preview of the app chrome for the Appearance settings group:
	// a mini Super Review window that reflects the draft theme, accent, UI font, and
	// file icons together (controls on top, one shared preview below).
	//
	// It mirrors the real app's structure — traffic lights + repo/branch top bar, a
	// sidebar with tabs / search / changed-file list / commit button, and a diff in
	// the main pane — so changing appearance settings reads like changing the app.
	// Renders its own palette inline (like ThemePreview) rather than relying on the
	// document's theme class, so it can show the DRAFT theme before the user saves.
	import { ACCENTS } from '@super-review/ui/accents';
	import { uiFontCss } from '@super-review/ui/store.svelte';
	import FileIcon from './FileIcon.svelte';
	import type { Accent } from '@super-review/core/types';

	interface Props {
		theme: 'light' | 'dark';
		accent: Accent;
		uiFont: string;
		showIcons?: boolean;
	}

	let { theme, accent, uiFont, showIcons = true }: Props = $props();

	interface Palette {
		background: string;
		card: string;
		sidebar: string;
		border: string;
		muted: string;
		mutedForeground: string;
		foreground: string;
		added: string;
		removed: string;
	}

	const LIGHT: Palette = {
		background: 'hsl(0 0% 100%)',
		card: 'hsl(0 0% 100%)',
		sidebar: 'hsl(0 0% 96%)',
		border: 'hsl(0 0% 89.8%)',
		muted: 'hsl(0 0% 90%)',
		mutedForeground: 'hsl(0 0% 45%)',
		foreground: 'hsl(0 0% 9%)',
		added: 'hsl(145 60% 40% / 0.16)',
		removed: 'hsl(0 65% 51% / 0.14)'
	};

	const DARK: Palette = {
		background: 'hsl(0 0% 6%)',
		card: 'hsl(0 0% 8%)',
		sidebar: 'hsl(0 0% 7%)',
		border: 'hsl(0 0% 14.9%)',
		muted: 'hsl(0 0% 22%)',
		mutedForeground: 'hsl(0 0% 55%)',
		foreground: 'hsl(0 0% 98%)',
		added: 'hsl(145 55% 45% / 0.2)',
		removed: 'hsl(0 65% 55% / 0.18)'
	};

	const p = $derived(theme === 'light' ? LIGHT : DARK);

	const accentOption = $derived(ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0]);
	// The "mono" accent is defined with document-theme tokens; map it to this
	// preview's own palette so it tracks the previewed theme. Other accents carry
	// theme-independent colors and pass through.
	const accentBg = $derived(accent === 'mono' ? p.foreground : accentOption.primary);
	const accentFg = $derived(accent === 'mono' ? p.background : accentOption.fg);

	const TABS = ['Unstaged', 'Branch', 'History'];
	const MOCK_FILES = [
		{ name: 'main.ts', path: 'src/main.ts', add: 12, del: 3, selected: true },
		{ name: 'format.ts', path: 'src/utils/format.ts', add: 5, del: 1, selected: false },
		{ name: 'README.md', path: 'README.md', add: 2, del: 0, selected: false }
	];
	// Faint code lines for the diff pane; a couple are tinted added/removed.
	const DIFF_LINES = [
		{ w: '82%', tint: '' },
		{ w: '64%', tint: 'removed' },
		{ w: '74%', tint: 'added' },
		{ w: '56%', tint: 'added' },
		{ w: '70%', tint: '' },
		{ w: '48%', tint: '' }
	];
</script>

<div
	class="chrome"
	style:background={p.background}
	style:border-color={p.border}
	style:color={p.foreground}
	style:font-family={uiFontCss(uiFont)}
>
	<!-- Top bar: traffic lights, then the repo / branch pickers. -->
	<div class="topbar" style:background={p.card} style:border-color={p.border}>
		<div class="lights">
			<span class="light" style:background="#ff5f57"></span>
			<span class="light" style:background="#febc2e"></span>
			<span class="light" style:background="#28c840"></span>
		</div>
		<span class="pill repo" style:background={p.muted}></span>
		<span class="slash" style:color={p.mutedForeground}>/</span>
		<span class="pill branch" style:background={p.muted}></span>
		<span class="spacer"></span>
		<span class="chip" style:background={p.muted}></span>
		<span class="chip" style:background={p.muted}></span>
		<span class="chip avatar" style:background={p.mutedForeground}></span>
	</div>

	<div class="body">
		<!-- Sidebar: tabs, search, changed-file list, commit button. -->
		<div class="sidebar" style:background={p.sidebar} style:border-color={p.border}>
			<div class="tabs">
				{#each TABS as t, i (t)}
					<span class="tab" style:color={i === 0 ? p.foreground : p.mutedForeground}>{t}</span>
				{/each}
			</div>

			<div class="search" style:background={p.background} style:border-color={p.border}></div>

			<div class="files">
				{#each MOCK_FILES as f (f.path)}
					<div
						class="file"
						class:selected={f.selected}
						style:background={f.selected ? p.muted : ''}
					>
						<span class="sel-bar" style:background={f.selected ? accentBg : 'transparent'}></span>
						{#if showIcons}
							<FileIcon path={f.path} class="size-3.5 shrink-0" />
						{/if}
						<span class="name">{f.name}</span>
						<span class="counts">
							{#if f.add}<span class="add">+{f.add}</span>{/if}
							{#if f.del}<span class="del">−{f.del}</span>{/if}
						</span>
					</div>
				{/each}
			</div>

			<div class="commit" style:border-color={p.border}>
				<span class="avatar-dot" style:background={p.muted}></span>
				<span class="msg" style:background={p.muted}></span>
				<span class="commit-btn" style:background={accentBg} style:color={accentFg}>Commit</span>
			</div>
		</div>

		<!-- Main: a file header, then diff lines. -->
		<div class="main">
			<div class="file-header" style:border-color={p.border} style:background={p.card}>
				{#if showIcons}
					<FileIcon path="src/main.ts" class="size-3.5 shrink-0" />
				{/if}
				<span class="path" style:background={p.muted}></span>
				<span class="spacer"></span>
				<span class="hpill" style:background={p.muted}></span>
				<span class="hpill" style:background={p.muted}></span>
			</div>
			<div class="diff">
				{#each DIFF_LINES as line, i (i)}
					<div
						class="line"
						style:background={line.tint === 'added'
							? p.added
							: line.tint === 'removed'
								? p.removed
								: 'transparent'}
					>
						<span class="gutter" style:color={p.mutedForeground}>{i + 1}</span>
						<span class="code" style:background={p.muted} style:width={line.w}></span>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.chrome {
		display: flex;
		flex-direction: column;
		aspect-ratio: 16 / 10;
		width: 100%;
		border-radius: 8px;
		border: 1px solid;
		overflow: hidden;
	}

	.topbar {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		padding: 0 8px;
		border-bottom: 1px solid;
		flex: 0 0 auto;
	}

	.lights {
		display: flex;
		gap: 4px;
		margin-right: 2px;
	}

	.light {
		height: 7px;
		width: 7px;
		border-radius: 999px;
	}

	.pill {
		height: 9px;
		border-radius: 3px;
	}

	.pill.repo {
		width: 74px;
	}

	.pill.branch {
		width: 96px;
	}

	.slash {
		font-size: 9px;
		line-height: 1;
	}

	.spacer {
		flex: 1;
	}

	.chip {
		height: 9px;
		width: 9px;
		border-radius: 2px;
	}

	.chip.avatar {
		border-radius: 999px;
	}

	.body {
		display: grid;
		grid-template-columns: 40% 1fr;
		flex: 1;
		min-height: 0;
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		border-right: 1px solid;
		overflow: hidden;
	}

	.tabs {
		display: flex;
		gap: 8px;
		padding: 7px 8px 5px;
		font-size: 8px;
		font-weight: 500;
	}

	.search {
		height: 15px;
		margin: 0 8px 6px;
		border-radius: 4px;
		border: 1px solid;
		flex: 0 0 auto;
	}

	.files {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0 6px;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.file {
		position: relative;
		display: flex;
		align-items: center;
		gap: 5px;
		height: 17px;
		padding: 0 6px;
		border-radius: 3px;
		font-size: 9px;
	}

	.file .sel-bar {
		position: absolute;
		left: 0;
		top: 3px;
		bottom: 3px;
		width: 2px;
		border-radius: 999px;
	}

	.file .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file .counts {
		margin-left: auto;
		display: flex;
		gap: 3px;
		font-size: 7px;
		font-variant-numeric: tabular-nums;
	}

	.file .add {
		color: hsl(145 60% 45%);
	}

	.file .del {
		color: hsl(0 65% 58%);
	}

	.commit {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 7px 8px;
		border-top: 1px solid;
		flex: 0 0 auto;
	}

	.avatar-dot {
		height: 12px;
		width: 12px;
		border-radius: 999px;
		flex: 0 0 auto;
	}

	.msg {
		height: 9px;
		flex: 1;
		border-radius: 3px;
	}

	.commit-btn {
		display: inline-flex;
		align-items: center;
		height: 15px;
		padding: 0 7px;
		border-radius: 4px;
		font-size: 8px;
		font-weight: 600;
		flex: 0 0 auto;
	}

	.main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	.file-header {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		padding: 0 8px;
		border-bottom: 1px solid;
		flex: 0 0 auto;
	}

	.file-header .path {
		height: 8px;
		width: 84px;
		border-radius: 3px;
	}

	.file-header .hpill {
		height: 8px;
		width: 22px;
		border-radius: 2px;
	}

	.diff {
		display: flex;
		flex-direction: column;
		padding: 4px 0;
		flex: 1;
		min-height: 0;
	}

	.line {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 16px;
		padding: 0 8px 0 0;
	}

	.line .gutter {
		width: 22px;
		text-align: right;
		font-size: 8px;
		font-variant-numeric: tabular-nums;
		flex: 0 0 auto;
	}

	.line .code {
		height: 5px;
		border-radius: 2px;
	}
</style>
