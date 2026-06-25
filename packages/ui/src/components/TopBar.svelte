<script lang="ts">
	import RepoSwitcher from './RepoSwitcher.svelte';
	import BranchPicker from './BranchPicker.svelte';
	import GithubSignIn from './GithubSignIn.svelte';
	import PrimaryActionButton from './PrimaryActionButton.svelte';
	import UpdateBranchButton from './UpdateBranchButton.svelte';
	import EditorButton from './EditorButton.svelte';
	import TerminalButton from './TerminalButton.svelte';
	import ChangesetButton from './ChangesetButton.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import { useSidebar } from './ui/sidebar';
	import CornerUpLeft from '@lucide/svelte/icons/corner-up-left';
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import PanelRight from '@lucide/svelte/icons/panel-right';
	import {
		actions,
		app,
		isReadOnlyView,
		sidebarHasUnresolvedComments
	} from '@super-review/ui/store.svelte';
	import type { HeaderItemVisibility } from '@super-review/core/types';

	// The left (changes / file list) sidebar's open state lives in the shared
	// Sidebar context provided in App.svelte; the left toggle reads + flips it.
	const sidebar = useSidebar();

	// Each entry in the header's right-click menu: the pref key it toggles and
	// its label.
	const menuItems: { key: keyof HeaderItemVisibility; label: string }[] = [
		{ key: 'changesToggle', label: 'Changes sidebar toggle' },
		{ key: 'commentsToggle', label: 'Comments sidebar toggle' },
		{ key: 'changeset', label: 'Changeset' },
		{ key: 'editor', label: 'Open in editor' },
		{ key: 'terminal', label: 'Open in terminal' }
	];

	// Right-click anywhere on the header to customize which optional controls
	// show, via a native context menu. Each item is a checkbox reflecting its
	// current visibility; toggling one persists the new state. A native menu
	// closes on each click, so we apply the single item it reports back.
	async function onHeaderContextMenu(e: MouseEvent): Promise<void> {
		// Nothing to toggle until a repo is open (the items only render then).
		if (!app.activeRepo) return;
		e.preventDefault();
		const result = await window.api.menu.showHeaderContextMenu({
			items: menuItems.map((it) => ({
				key: it.key,
				label: it.label,
				checked: app.headerItems[it.key]
			}))
		});
		if (result) actions.setHeaderItem(result.key, result.checked);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- The header is a banner landmark, not a control; the contextmenu handler is
     a supplementary right-click affordance for customizing the header. -->
<header
	class="relative z-30 flex h-11 items-center gap-2 border-b border-border bg-card/40 px-2 backdrop-blur"
	style="-webkit-app-region: drag"
	oncontextmenu={onHeaderContextMenu}
>
	<!-- Pad past the macOS traffic-light buttons (titleBarStyle: hiddenInset). -->
	<div class="flex items-center gap-1 pl-20" style="-webkit-app-region: no-drag">
		<!-- Changes (left file-list) sidebar toggle, pinned to the left side and
		     distinguished by the panel-left icon. Hidable via the header menu. -->
		{#if app.activeRepo && app.headerItems.changesToggle}
			<button
				type="button"
				onclick={() => sidebar.toggle()}
				title="Changes"
				aria-pressed={sidebar.open}
				class={[
					'mr-1 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
					sidebar.open && 'bg-muted text-foreground hover:bg-muted'
				]}
			>
				<PanelLeft class="size-4" />
			</button>
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
			<!-- Adding a changeset edits the checked-out working tree, which is
			     valid regardless of what's on screen — keep it available in
			     read-only views and on every tab. Hidable via the header menu. -->
			{#if app.headerItems.changeset}
				<ChangesetButton />
			{/if}
			<!-- Update-branch, editor and terminal all act on the *checked-out*
			     branch / working tree — not what a read-only view shows. Hide them
			     there so we don't operate on (or send the user to) the wrong branch,
			     or imply the view is writable. -->
			{#if !isReadOnlyView()}
				<UpdateBranchButton />
				{#if app.headerItems.editor}
					<EditorButton />
				{/if}
				{#if app.headerItems.terminal}
					<TerminalButton />
				{/if}
			{/if}
			<PrimaryActionButton />
		{/if}
		<GithubSignIn />
		<!-- Comments (right) sidebar toggle, pinned to the right side and
		     distinguished by the panel-right icon. Hidable via the header menu. -->
		{#if app.activeRepo && app.headerItems.commentsToggle}
			<button
				type="button"
				onclick={() => actions.toggleCommentsSidebar()}
				title="Comments"
				aria-pressed={app.commentsSidebarOpen}
				class={[
					'relative ml-1 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
					app.commentsSidebarOpen && 'bg-muted text-foreground hover:bg-muted'
				]}
			>
				<PanelRight class="size-4" />
				{#if sidebarHasUnresolvedComments()}
					<span
						class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full"
						style="background: var(--color-primary);"
					></span>
				{/if}
			</button>
		{/if}
	</div>
</header>
