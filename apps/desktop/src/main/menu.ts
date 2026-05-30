import { BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import type { BranchMenuAction, BranchMenuState } from '../shared/types.js';

// The most recent Branch-menu state the renderer pushed. Drives which items are
// enabled and their dynamic labels. Defaults to "no repo" so the menu is built
// (greyed out) before the renderer reports in.
let branchState: BranchMenuState = {
	hasRepo: false,
	defaultBranch: 'main',
	onDefaultBranch: false,
	hasChanges: false,
	hasGithub: false,
	branchPRNumber: null
};

// Send a chosen Branch action to the focused window (falling back to the first
// window). The renderer maps it to the matching store flow.
function sendBranchAction(action: BranchMenuAction): void {
	const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
	win?.webContents.send('menu:branch-action', action);
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
		{ label: 'Branch', submenu: buildBranchSubmenu() },
		{ role: 'windowMenu' }
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
	buildAppMenu();
}
