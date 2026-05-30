<script lang="ts">
	import RepoSwitcher from './RepoSwitcher.svelte';
	import BranchPicker from './BranchPicker.svelte';
	import GithubSignIn from './GithubSignIn.svelte';
	import PrimaryActionButton from './PrimaryActionButton.svelte';
	import UpdateBranchButton from './UpdateBranchButton.svelte';
	import EditorButton from './EditorButton.svelte';
	import TerminalButton from './TerminalButton.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import * as Sidebar from './ui/sidebar';
	import { app } from '$lib/store.svelte';
</script>

<header
	class="relative z-30 flex h-11 items-center gap-2 border-b border-border bg-card/40 px-2 backdrop-blur"
	style="-webkit-app-region: drag"
>
	<!-- Pad past the macOS traffic-light buttons (titleBarStyle: hiddenInset). -->
	<div class="flex items-center gap-1 pl-20" style="-webkit-app-region: no-drag">
		{#if app.activeRepo}
			<Sidebar.Trigger class="size-6" />
		{/if}
		<RepoSwitcher />
		{#if app.activeRepo}
			<span class="text-muted-foreground">/</span>
			<BranchPicker />
		{/if}
	</div>
	<div class="flex-1"></div>

	<div class="flex items-center gap-1" style="-webkit-app-region: no-drag">
		{#if app.activeRepo}
			<RefreshButton />
			<UpdateBranchButton />
			<EditorButton />
			<TerminalButton />
			<PrimaryActionButton />
		{/if}
		<GithubSignIn />
	</div>
</header>
