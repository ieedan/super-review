import { BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import type {
	BranchMenuAction,
	BranchMenuState,
	HelpMenuAction,
	RepositoryMenuAction,
	RepositoryMenuState
} from '../shared/types.js';

// The most recent Branch-menu state the renderer pushed. Drives which items are
// enabled and their dynamic labels. Defaults to "no repo" so the menu is built
// (greyed out) before the renderer reports in.
let branchState: BranchMenuState = {
	hasRepo: false,
	defaultBranch: 'main',
	onDefaultBranch: false,
	hasChanges: false,
	hasGithub: false,
	hasUpstream: false,
	branchPRNumber: null
};

// The most recent Repository-menu state the renderer pushed (mirrors branchState
// for the "Repository" submenu). Defaults to "no repo" so the menu builds greyed
// out before the renderer reports in.
let repoState: RepositoryMenuState = {
	hasRepo: false,
	hasRemote: false,
	hasGithub: false,
	editorLabel: null,
	terminalLabel: null,
	revealLabel: 'Show in Finder'
};

// Send a chosen Branch action to the focused window (falling back to the first
// window). The renderer maps it to the matching store flow.
function sendBranchAction(action: BranchMenuAction): void {
	const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
	win?.webContents.send('menu:branch-action', action);
}

function sendRepositoryAction(action: RepositoryMenuAction): void {
	const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
	win?.webContents.send('menu:repository-action', action);
}

function sendHelpAction(action: HelpMenuAction): void {
	const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
	win?.webContents.send('menu:help-action', action);
}

// App-global "Help" submenu. Unlike Repository/Branch it carries no enablement
// state — its items work regardless of the active repo. "Send Feedback…" is the
// canonical Cmd/Ctrl+Shift+F entry point; the same dialog also backs the error
// toast's "Report this error" button.
function buildHelpSubmenu(): MenuItemConstructorOptions[] {
	return [
		{
			label: 'Send Feedback…',
			accelerator: 'Shift+CmdOrCtrl+F',
			click: () => sendHelpAction('sendFeedback')
		}
	];
}

// Build the "Repository" submenu from repoState — mirrors GitHub Desktop's
// Repository menu. Items whose dynamic label is null (no editor/terminal
// detected) are omitted entirely so the menu matches what's available.
function buildRepositorySubmenu(): MenuItemConstructorOptions[] {
	const s = repoState;
	const item = (
		label: string,
		action: RepositoryMenuAction,
		enabled: boolean,
		accelerator?: string
	): MenuItemConstructorOptions => ({
		label,
		enabled,
		accelerator,
		click: () => sendRepositoryAction(action)
	});

	return [
		item('Push', 'push', s.hasRepo && s.hasRemote, 'CmdOrCtrl+P'),
		item('Pull', 'pull', s.hasRepo && s.hasRemote, 'Shift+CmdOrCtrl+P'),
		item('Fetch', 'fetch', s.hasRepo && s.hasRemote, 'Shift+CmdOrCtrl+T'),
		{ type: 'separator' },
		item('Remove…', 'remove', s.hasRepo, 'CmdOrCtrl+Backspace'),
		{ type: 'separator' },
		item('View on GitHub', 'viewOnGithub', s.hasRepo && s.hasGithub, 'Shift+CmdOrCtrl+G'),
		...(s.terminalLabel
			? [item(`Open in ${s.terminalLabel}`, 'openInTerminal', s.hasRepo, 'Control+`')]
			: []),
		// Reveal-in-file-manager moved off Shift+CmdOrCtrl+F so that combo can be the
		// global "Send Feedback…" shortcut (see buildHelpSubmenu); Alt+CmdOrCtrl+R
		// ("Reveal") is free across the role menus.
		item(s.revealLabel, 'showInFinder', s.hasRepo, 'Alt+CmdOrCtrl+R'),
		...(s.editorLabel
			? [item(`Open in ${s.editorLabel}`, 'openInEditor', s.hasRepo, 'Shift+CmdOrCtrl+A')]
			: []),
		{ type: 'separator' },
		item('Create Issue on GitHub', 'createIssue', s.hasRepo && s.hasGithub, 'CmdOrCtrl+I'),
		{ type: 'separator' },
		item('Clean Up Local Branches…', 'cleanupBranches', s.hasRepo),
		item('Repository Settings…', 'settings', s.hasRepo)
	];
}

function buildBranchSubmenu(): MenuItemConstructorOptions[] {
	const s = branchState;
	const branchAction = (
		label: string,
		action: BranchMenuAction,
		enabled: boolean,
		accelerator?: string
	): MenuItemConstructorOptions => ({
		label,
		enabled,
		accelerator,
		click: () => sendBranchAction(action)
	});

	return [
		branchAction('New Branch…', 'newBranch', s.hasRepo, 'Shift+CmdOrCtrl+N'),
		{ type: 'separator' },
		branchAction(
			`Update from ${s.defaultBranch}`,
			'updateFromDefault',
			s.hasRepo && !s.onDefaultBranch,
			'Shift+CmdOrCtrl+U'
		),
		// Only forks have an upstream — hide the item entirely otherwise so the
		// menu matches the repo, like GitHub Desktop.
		...(s.hasUpstream
			? [branchAction(`Update from upstream/${s.defaultBranch}`, 'updateFromUpstream', s.hasRepo)]
			: []),
		branchAction(
			'Delete Branch…',
			'deleteBranch',
			s.hasRepo && !s.onDefaultBranch,
			'Shift+CmdOrCtrl+D'
		),
		{ type: 'separator' },
		branchAction(
			'Discard All Changes…',
			'discardAll',
			s.hasRepo && s.hasChanges,
			'Shift+CmdOrCtrl+Backspace'
		),
		{ type: 'separator' },
		branchAction(
			'Preview Pull Request',
			'previewPR',
			s.hasRepo && !s.onDefaultBranch,
			'Alt+CmdOrCtrl+P'
		),
		branchAction(
			s.branchPRNumber ? `View Pull Request #${s.branchPRNumber}` : 'Create Pull Request',
			'createPR',
			s.hasRepo && s.hasGithub && !s.onDefaultBranch
		)
	];
}

// Rebuild and install the application menu from the current branchState. Cheap
// enough to call on every state change; the standard role-based submenus keep
// editing/window/zoom shortcuts working now that we own the menu.
function buildAppMenu(): void {
	const isMac = process.platform === 'darwin';

	const template: MenuItemConstructorOptions[] = [
		...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
		{ role: 'fileMenu' },
		{ role: 'editMenu' },
		{ role: 'viewMenu' },
		{ label: 'Repository', submenu: buildRepositorySubmenu() },
		{ label: 'Branch', submenu: buildBranchSubmenu() },
		{ role: 'windowMenu' },
		{ label: 'Help', submenu: buildHelpSubmenu() }
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Install the application menu and start listening for renderer state pushes.
// Call once after app.whenReady().
export function setupAppMenu(): void {
	ipcMain.on('menu:setBranchState', (_e, state: BranchMenuState) => {
		branchState = state;
		buildAppMenu();
	});
	ipcMain.on('menu:setRepositoryState', (_e, state: RepositoryMenuState) => {
		repoState = state;
		buildAppMenu();
	});
	buildAppMenu();
}
