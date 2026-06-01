<script lang="ts">
	// Headless glue between the native "Repository" menu (built in the main
	// process) and the renderer — mirrors BranchMenu. Renders nothing: it pushes
	// the current enablement/labels up so the native menu reflects the active repo,
	// and runs the matching store flow when an item is chosen. Mounted once at the
	// app root.
	import { onMount } from 'svelte';
	import { confirmDelete } from './ui/confirm-delete-dialog';
	import {
		actions,
		app,
		effectiveEditor,
		effectiveTerminal,
		EDITOR_LABELS,
		TERMINAL_LABELS
	} from '$lib/store.svelte';
	import type { RepositoryMenuAction, RepositoryMenuState } from '@shared/types';

	function revealLabel(): string {
		return app.platform === 'win32'
			? 'Show in Explorer'
			: app.platform === 'linux'
				? 'Show in File Manager'
				: 'Show in Finder';
	}

	// Keep the native Repository menu's enabled state + dynamic labels in sync,
	// deduped so unrelated reactive churn doesn't rebuild the OS menu.
	let lastSent = '';
	$effect(() => {
		const repo = app.activeRepo;
		const editor = effectiveEditor();
		const terminal = effectiveTerminal();
		const state: RepositoryMenuState = {
			hasRepo: !!repo,
			hasRemote: !!app.pushStatus?.hasRemote,
			hasGithub: !!repo?.githubOwner && !!repo?.githubRepo,
			editorLabel: editor ? EDITOR_LABELS[editor] : null,
			terminalLabel: terminal ? TERMINAL_LABELS[terminal] : null,
			revealLabel: revealLabel()
		};
		const serialized = JSON.stringify(state);
		if (serialized === lastSent) return;
		lastSent = serialized;
		window.api.menu.setRepositoryState(state);
	});

	// Mirror GitHub Desktop's remove dialog: warning, the repo's path, and an
	// opt-in to also move the folder to the OS trash (same as the repo picker).
	function requestRemove(): void {
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

	function handle(action: RepositoryMenuAction): void {
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
				requestRemove();
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
			case 'settings':
				actions.openRepoSettingsDialog();
				return;
		}
	}

	onMount(() => window.api.events.onRepositoryMenuAction(handle));
</script>
