// Shared handlers for the application Branch / Repository menus. Used by the
// headless BranchMenu / RepositoryMenu glue (native macOS menu + accelerators)
// and by the Windows HTML AppMenuBar so both paths run the same store flows.
import { confirmDelete } from './components/ui/confirm-delete-dialog';
import {
	actions,
	app,
	effectiveEditor,
	effectiveTerminal,
	EDITOR_LABELS,
	TERMINAL_LABELS
} from '@super-review/ui/store.svelte';
import type {
	BranchMenuAction,
	BranchMenuState,
	RepositoryMenuAction,
	RepositoryMenuState
} from '@super-review/core/types';

export function revealInFileManagerLabel(): string {
	return app.platform === 'win32'
		? 'Show in Explorer'
		: app.platform === 'linux'
			? 'Show in File Manager'
			: 'Show in Finder';
}

export function branchMenuState(): BranchMenuState {
	const repo = app.activeRepo;
	const defaultBranch = repo?.defaultBranch ?? 'main';
	return {
		hasRepo: !!repo,
		defaultBranch,
		onDefaultBranch: !!repo && app.currentBranch === defaultBranch,
		hasChanges: app.unstagedFileCount > 0,
		hasGithub: !!repo?.githubOwner && !!repo?.githubRepo,
		hasUpstream: !!repo?.upstreamOwner && !!repo?.upstreamRepo,
		branchPRNumber: app.branchPR?.number ?? null
	};
}

export function repositoryMenuState(): RepositoryMenuState {
	const repo = app.activeRepo;
	const editor = effectiveEditor();
	const terminal = effectiveTerminal();
	return {
		hasRepo: !!repo,
		hasRemote: !!app.pushStatus?.hasRemote,
		hasGithub: !!repo?.githubOwner && !!repo?.githubRepo,
		editorLabel: editor ? EDITOR_LABELS[editor] : null,
		terminalLabel: terminal ? TERMINAL_LABELS[terminal] : null,
		revealLabel: revealInFileManagerLabel()
	};
}

function requestDeleteCurrentBranch(): void {
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

function requestDiscardAllChanges(): void {
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

function requestRemoveRepo(): void {
	const repo = app.activeRepo;
	if (!repo) return;
	const trashLabel = app.platform === 'win32' ? 'Recycle Bin' : 'Trash';
	confirmDelete({
		title: 'Remove repository',
		icon: 'warning',
		description: `Are you sure you want to remove the repository "${repo.name}" from super-review?`,
		details: {
			caption: 'The repository will be removed from super-review:',
			value: repo.path
		},
		checkbox: { label: `Also move this repository to ${trashLabel}`, default: false },
		confirm: { text: 'Remove' },
		onConfirm: async ({ checked }) => {
			await actions.removeRepo(repo.id, checked);
		}
	});
}

export function handleBranchMenuAction(action: BranchMenuAction): void {
	switch (action) {
		case 'newBranch':
			actions.openCreateBranchDialog();
			return;
		case 'updateFromDefault':
			void actions.updateFromDefault();
			return;
		case 'updateFromUpstream':
			void actions.updateFromUpstream();
			return;
		case 'deleteBranch':
			requestDeleteCurrentBranch();
			return;
		case 'discardAll':
			requestDiscardAllChanges();
			return;
		case 'previewPR':
			void actions.setContextTab('branch');
			return;
		case 'createPR':
			void actions.openPRPage();
			return;
	}
}

export function handleRepositoryMenuAction(action: RepositoryMenuAction): void {
	switch (action) {
		case 'push':
			void actions.push();
			return;
		case 'pull':
			void actions.pull();
			return;
		case 'fetch':
			void actions.fetchAndRefresh();
			return;
		case 'remove':
			requestRemoveRepo();
			return;
		case 'viewOnGithub':
			void actions.openRepoOnGithub();
			return;
		case 'openInTerminal':
			void actions.openInTerminal();
			return;
		case 'showInFinder':
			void actions.openRepoInFileManager();
			return;
		case 'openInEditor':
			void actions.openInEditor();
			return;
		case 'createIssue':
			void actions.createIssueOnGithub();
			return;
		case 'cleanupBranches':
			actions.openCleanupBranchesDialog();
			return;
		case 'settings':
			actions.openRepoSettingsDialog();
			return;
	}
}
