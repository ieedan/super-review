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
	import { CornerUpLeft, MessageSquare } from 'lucide-svelte';
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
			<!-- Toggle the right-hand local-comments sidebar. Highlighted while open
			     or whenever the active context has comments, so they're discoverable. -->
			<button
				type="button"
				onclick={() => actions.toggleCommentsSidebar()}
				title="Comments"
				aria-pressed={app.commentsSidebarOpen}
				class={[
					'relative grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
					app.commentsSidebarOpen && 'bg-accent text-foreground'
				]}
			>
				<MessageSquare class="size-4" />
				{#if app.localComments.length > 0}
					<span
						class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full"
						style="background: var(--color-primary);"
					></span>
				{/if}
			</button>
		{/if}
		<GithubSignIn />
	</div>
</header>
