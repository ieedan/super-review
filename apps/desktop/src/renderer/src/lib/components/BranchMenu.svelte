<script lang="ts">
	// Headless glue between the native macOS "Branch" menu (built in the main
	// process) and the renderer. Renders nothing: it (1) pushes the current
	// enablement/label state up so the menu greys out inapplicable items, and
	// (2) runs the matching store flow when a menu item is chosen. Mounted once
	// at the app root so it tracks state even when no repo is open.
	import { onMount } from 'svelte';
	import { confirmDelete } from './ui/confirm-delete-dialog';
	import { actions, app } from '$lib/store.svelte';
	import type { BranchMenuAction, BranchMenuState } from '@shared/types';

	// Keep the native Branch menu's enabled state + dynamic labels in sync.
	// Deduped so unrelated reactive churn (e.g. file-list updates) doesn't rebuild
	// the OS menu unless something it shows actually changed.
	let lastSent = '';
	$effect(() => {
		const repo = app.activeRepo;
		const defaultBranch = repo?.defaultBranch ?? 'main';
		const state: BranchMenuState = {
			hasRepo: !!repo,
			defaultBranch,
			onDefaultBranch: !!repo && app.currentBranch === defaultBranch,
			hasChanges: app.unstagedFileCount > 0,
			hasGithub: !!repo?.githubOwner && !!repo?.githubRepo,
			branchPRNumber: app.branchPR?.number ?? null
		};
		const serialized = JSON.stringify(state);
		if (serialized === lastSent) return;
		lastSent = serialized;
		window.api.menu.setBranchState(state);
	});

	// Confirm before deleting the current branch. deleteCurrentBranch switches to
	// the default branch first (git can't delete the checked-out branch), so the
	// copy says so; the remote checkbox mirrors the branch picker's delete flow.
	function requestDeleteCurrent(): void {
		const name = app.currentBranch;
		if (!name) return;
		const upstream = app.branches.find((b) => b.name === name)?.upstream;
		const defaultBranch = app.activeRepo?.defaultBranch ?? 'main';
		confirmDelete({
			title: `Delete branch "${name}"?`,
			description: `This switches to "${defaultBranch}" and deletes the local branch "${name}". This can't be undone.`,
			checkbox: upstream
				? {
						label: `Also delete ${upstream} on the remote`,
						description: "Collaborators who track this branch may lose work that isn't pushed.",
						default: false
					}
				: undefined,
			confirm: { text: 'Delete branch' },
			onConfirm: async ({ checked }) => {
				const ok = await actions.deleteCurrentBranch({ deleteRemote: checked });
				if (!ok) throw new Error('delete failed');
			}
		});
	}

	// Discard every uncommitted change. Destructive and not fully undoable
	// (untracked files only recoverable from the trash), so always confirm.
	function requestDiscardAll(): void {
		const n = app.unstagedFileCount;
		const count = n ? ` to ${n} file${n === 1 ? '' : 's'}` : '';
		confirmDelete({
			title: 'Discard all changes?',
			description: `This discards your uncommitted changes${count}. Tracked files revert to their last commit; new files are moved to the trash.`,
			confirm: { text: 'Discard changes' },
			onConfirm: async () => {
				const ok = await actions.discardAllChanges();
				if (!ok) throw new Error('discard failed');
			}
		});
	}

	function handle(action: BranchMenuAction): void {
		switch (action) {
			case 'newBranch':
				actions.openCreateBranchDialog();
				return;
			case 'updateFromDefault':
				void actions.updateFromDefault();
				return;
			case 'deleteBranch':
				requestDeleteCurrent();
				return;
			case 'discardAll':
				requestDiscardAll();
				return;
			case 'previewPR':
				void actions.setContextTab('branch');
				return;
			case 'createPR':
				void actions.openPRPage();
				return;
		}
	}

	onMount(() => window.api.events.onBranchMenuAction(handle));
</script>
