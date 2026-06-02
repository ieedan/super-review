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
	import { CornerUpLeft } from 'lucide-svelte';
	import { actions, app, isReadOnlyView } from '$lib/store.svelte';
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
			<!-- While reviewing a branch or PR read-only, the picker shows the
			     *viewed* target; this pill surfaces what's actually checked out and
			     clicks back to it. Hidden when nothing is being viewed read-only. -->
			{#if isReadOnlyView()}
				<button
					type="button"
					onclick={() => actions.returnToCheckedOutBranch()}
					title={`Reviewing read-only — back to the checked-out branch (${app.currentBranch})`}
					class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<CornerUpLeft class="size-3.5" />
					<span class="font-mono">{app.currentBranch}</span>
				</button>
			{/if}
		{/if}
	</div>
	<div class="flex-1"></div>

	<div class="flex items-center gap-1" style="-webkit-app-region: no-drag">
		{#if app.activeRepo}
			<RefreshButton />
			<UpdateBranchButton />
			<!-- Editor/terminal open the working tree, which is the *checked-out*
			     branch — not what a read-only view shows. Hide them there so we don't
			     send the user to files that don't match the view (or imply it's
			     writable). -->
			{#if !isReadOnlyView()}
				<EditorButton />
				<TerminalButton />
			{/if}
			<PrimaryActionButton />
		{/if}
		<GithubSignIn />
	</div>
</header>
