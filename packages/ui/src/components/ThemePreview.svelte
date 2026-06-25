<script lang="ts">
	// Mini-mockup of the app chrome rendered in a specific theme. Uses inline
	// color tokens (not Tailwind dark: variants) so each preview shows its own
	// theme regardless of the document's class. Values mirror app.css so the
	// preview reads the same as the real app once selected.

	interface Props {
		theme: 'light' | 'dark';
	}

	let { theme }: Props = $props();

	interface Palette {
		background: string;
		card: string;
		sidebar: string;
		border: string;
		muted: string;
		mutedForeground: string;
		primary: string;
	}

	const LIGHT: Palette = {
		background: 'hsl(0 0% 100%)',
		card: 'hsl(0 0% 100%)',
		sidebar: 'hsl(0 0% 96%)',
		border: 'hsl(0 0% 89.8%)',
		muted: 'hsl(0 0% 92%)',
		mutedForeground: 'hsl(0 0% 65%)',
		primary: 'hsl(0 0% 9%)'
	};

	const DARK: Palette = {
		background: 'hsl(0 0% 6%)',
		card: 'hsl(0 0% 8%)',
		sidebar: 'hsl(0 0% 7%)',
		border: 'hsl(0 0% 14.9%)',
		muted: 'hsl(0 0% 20%)',
		mutedForeground: 'hsl(0 0% 40%)',
		primary: 'hsl(0 0% 98%)'
	};

	const p = $derived(theme === 'light' ? LIGHT : DARK);
</script>

<div class="theme-preview" style:background={p.background} style:border-color={p.border}>
	<!-- Top bar -->
	<div class="topbar" style:background={p.card} style:border-color={p.border}>
		<span class="dot" style:background={p.muted}></span>
		<span class="pill" style:background={p.muted}></span>
	</div>

	<div class="body">
		<!-- Sidebar / file list -->
		<div class="sidebar" style:background={p.sidebar} style:border-color={p.border}>
			<span class="row strong" style:background={p.mutedForeground}></span>
			<span class="row" style:background={p.muted}></span>
			<span class="row short" style:background={p.muted}></span>
			<span class="row" style:background={p.muted}></span>
			<span class="row short" style:background={p.muted}></span>
		</div>

		<!-- Main content -->
		<div class="main">
			<span class="row" style:background={p.muted}></span>
			<span class="row short" style:background={p.muted}></span>
			<span class="row" style:background={p.muted}></span>
			<!-- Uses the live accent (primary) so the preview reflects the chosen accent. -->
			<span class="button" style:background="var(--color-primary)"></span>
		</div>
	</div>
</div>

<style>
	.theme-preview {
		display: flex;
		flex-direction: column;
		aspect-ratio: 16 / 10;
		width: 100%;
		border-radius: 6px;
		border: 1px solid;
		overflow: hidden;
	}

	.topbar {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 14px;
		padding: 0 5px;
		border-bottom: 1px solid;
		flex: 0 0 auto;
	}

	.body {
		display: grid;
		grid-template-columns: 36% 1fr;
		flex: 1;
		min-height: 0;
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 7px 6px;
		border-right: 1px solid;
	}

	.main {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
	}

	.dot {
		display: inline-block;
		height: 5px;
		width: 5px;
		border-radius: 999px;
	}

	.pill {
		display: inline-block;
		height: 5px;
		width: 40px;
		border-radius: 2px;
	}

	.row {
		display: block;
		height: 4px;
		width: 100%;
		border-radius: 2px;
	}

	.row.short {
		width: 60%;
	}

	.row.strong {
		height: 5px;
		width: 70%;
	}

	.button {
		position: absolute;
		bottom: 8px;
		right: 8px;
		height: 10px;
		width: 22px;
		border-radius: 3px;
	}
</style>
