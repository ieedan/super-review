<script lang="ts">
	import RepoSwitcher from './RepoSwitcher.svelte';
	import BranchPicker from './BranchPicker.svelte';
	import GithubSignIn from './GithubSignIn.svelte';
	import PrimaryActionButton from './PrimaryActionButton.svelte';
	import UpdateBranchButton from './UpdateBranchButton.svelte';
	import EditorButton from './EditorButton.svelte';
	import TerminalButton from './TerminalButton.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import { useSidebar } from './ui/sidebar';
	import { CornerUpLeft, FileDiff, MessageSquare } from 'lucide-svelte';
	import { actions, app, isReadOnlyView, sidebarHasUnresolvedComments } from '$lib/store.svelte';

	// The left (changes / file list) sidebar's open state lives in the shared
	// Sidebar context provided in App.svelte; the center toggle reads + flips it.
	const sidebar = useSidebar();
</script>

<header
	class="relative z-30 flex h-11 items-center gap-2 border-b border-border bg-card/40 px-2 backdrop-blur"
	style="-webkit-app-region: drag"
>
	<!-- Pad past the macOS traffic-light buttons (titleBarStyle: hiddenInset). -->
	<div class="flex items-center gap-1 pl-20" style="-webkit-app-region: no-drag">
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
					title={`Reviewing read-only. Back to the checked-out branch (${app.currentBranch})`}
					class="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<CornerUpLeft class="size-3.5" />
					<span class="font-mono">{app.currentBranch}</span>
				</button>
			{/if}
		{/if}
	</div>
	<div class="flex-1"></div>

	<!-- Sidebar toggles, centered in the header: the changes (file list) sidebar
	     on the left, the comments sidebar on the right. Each is a toggle that takes
	     the selected-tab background while its sidebar is open. -->
	{#if app.activeRepo}
		<div
			class="absolute top-0 bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1"
			style="-webkit-app-region: no-drag"
		>
			<button
				type="button"
				onclick={() => sidebar.toggle()}
				title="Changes"
				aria-pressed={sidebar.open}
				class={[
					'grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
					sidebar.open && 'bg-muted text-foreground hover:bg-muted'
				]}
			>
				<FileDiff class="size-4" />
			</button>
			<button
				type="button"
				onclick={() => actions.toggleCommentsSidebar()}
				title="Comments"
				aria-pressed={app.commentsSidebarOpen}
				class={[
					'relative grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
					app.commentsSidebarOpen && 'bg-muted text-foreground hover:bg-muted'
				]}
			>
				<MessageSquare class="size-4" />
				{#if sidebarHasUnresolvedComments()}
					<span
						class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full"
						style="background: var(--color-primary);"
					></span>
				{/if}
			</button>
		</div>
	{/if}

	<div class="flex items-center gap-1" style="-webkit-app-region: no-drag">
		{#if app.activeRepo}
			<RefreshButton />
			<!-- Update-branch, editor and terminal all act on the *checked-out*
			     branch / working tree — not what a read-only view shows. Hide them
			     there so we don't operate on (or send the user to) the wrong branch,
			     or imply the view is writable. -->
			{#if !isReadOnlyView()}
				<UpdateBranchButton />
				<EditorButton />
				<TerminalButton />
			{/if}
			<PrimaryActionButton />
		{/if}
		<GithubSignIn />
	</div>
</header>
