import { BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import type {
	BranchMenuAction,
	BranchMenuState,
	HelpMenuAction,
	RepositoryMenuAction,
	RepositoryMenuState
} from '../shared/types.js';
import { MENU_ACCELERATORS as A } from '../shared/hotkeys.js';

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
	canPush: false,
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

// Build the "Help" submenu. Static (no per-repo state) — "Send Feedback" is
// always available since it files against the project's own repo. Its
// accelerator (⇧⌘/) doubles as the global feedback shortcut, so the renderer
// needs no separate keybinding.
function buildHelpSubmenu(): MenuItemConstructorOptions[] {
	return [
		{
			label: 'Send Feedback…',
			accelerator: A.sendFeedback.accelerator,
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
		// Push is gated on there actually being commits to push so ⌘P is inert on an
		// up-to-date branch. Pull/Fetch stay on `hasRemote`: how far behind the
		// branch is isn't known until a fetch, so gating them would be wrong.
		item('Push', 'push', s.hasRepo && s.hasRemote && s.canPush, A.push.accelerator),
		item('Pull', 'pull', s.hasRepo && s.hasRemote, A.pull.accelerator),
		item('Fetch', 'fetch', s.hasRepo && s.hasRemote, A.fetch.accelerator),
		{ type: 'separator' },
		item('Remove…', 'remove', s.hasRepo, A.removeRepo.accelerator),
		{ type: 'separator' },
		item('View on GitHub', 'viewOnGithub', s.hasRepo && s.hasGithub, A.viewOnGithub.accelerator),
		...(s.terminalLabel
			? [
					item(
						`Open in ${s.terminalLabel}`,
						'openInTerminal',
						s.hasRepo,
						A.openInTerminal.accelerator
					)
				]
			: []),
		item(s.revealLabel, 'showInFinder', s.hasRepo, A.showInFinder.accelerator),
		...(s.editorLabel
			? [item(`Open in ${s.editorLabel}`, 'openInEditor', s.hasRepo, A.openInEditor.accelerator)]
			: []),
		{ type: 'separator' },
		item(
			'Create Issue on GitHub',
			'createIssue',
			s.hasRepo && s.hasGithub,
			A.createIssue.accelerator
		),
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
		branchAction('New Branch…', 'newBranch', s.hasRepo, A.newBranch.accelerator),
		{ type: 'separator' },
		branchAction(
			`Update from ${s.defaultBranch}`,
			'updateFromDefault',
			s.hasRepo && !s.onDefaultBranch,
			A.updateFromDefault.accelerator
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
			A.deleteBranch.accelerator
		),
		{ type: 'separator' },
		branchAction(
			'Discard All Changes…',
			'discardAll',
			s.hasRepo && s.hasChanges,
			A.discardAll.accelerator
		),
		{ type: 'separator' },
		branchAction(
			'Preview Pull Request',
			'previewPR',
			s.hasRepo && !s.onDefaultBranch,
			A.previewPR.accelerator
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
//
// On macOS this is the system menu bar. On Windows the strip is hidden
// (titleBarStyle:hidden) and AppMenuBar renders a shadcn Menubar instead; we
// still install the menu so accelerators keep firing.
function buildAppMenu(): void {
	const isMac = process.platform === 'darwin';

	const template: MenuItemConstructorOptions[] = [
		...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
		{ id: 'file', role: 'fileMenu' },
		{ id: 'edit', role: 'editMenu' },
		{ id: 'view', role: 'viewMenu' },
		{ id: 'repository', label: 'Repository', submenu: buildRepositorySubmenu() },
		{ id: 'branch', label: 'Branch', submenu: buildBranchSubmenu() },
		{ id: 'window', role: 'windowMenu' },
		{ id: 'help', role: 'help', submenu: buildHelpSubmenu() }
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
