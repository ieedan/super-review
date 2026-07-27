import { app, BrowserWindow, ipcMain } from 'electron';
import type { WindowChromeAction } from '../shared/types.js';

// Height of the Windows custom menu bar (AppMenuBar.svelte). Must match the
// titleBarOverlay height so the native min/max/close buttons sit on that row.
export const MENU_BAR_HEIGHT = 30;

// Theme-matched Window Controls Overlay. Color is transparent so the
// AppMenuBar (styled like TopBar: bg-card/40) shows through under the native
// buttons; only the glyph color changes with theme.
export function titleBarOverlayFor(theme: 'light' | 'dark'): {
	color: string;
	symbolColor: string;
	height: number;
} {
	if (theme === 'light') {
		return { color: '#00000000', symbolColor: '#1a1a1a', height: MENU_BAR_HEIGHT };
	}
	return { color: '#00000000', symbolColor: '#c4c4c4', height: MENU_BAR_HEIGHT };
}

// Re-apply the overlay theme to every open window. No-op off Windows, where we
// don't use titleBarOverlay.
export function syncTitleBarOverlay(theme: 'light' | 'dark'): void {
	if (process.platform !== 'win32') return;
	const overlay = titleBarOverlayFor(theme);
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.setTitleBarOverlay(overlay);
	}
}

function targetWindow(sender: Electron.WebContents): BrowserWindow | null {
	const win = BrowserWindow.fromWebContents(sender);
	if (win && !win.isDestroyed()) return win;
	return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

// Run a role-menu / window-chrome action for the sender's window. Powers the
// Windows HTML AppMenuBar (File / Edit / View / Window) while macOS keeps the
// native menu bar for the same roles.
export function performWindowChromeAction(
	sender: Electron.WebContents,
	action: WindowChromeAction
): void {
	const win = targetWindow(sender);
	const wc = win?.webContents;
	switch (action) {
		case 'undo':
			wc?.undo();
			return;
		case 'redo':
			wc?.redo();
			return;
		case 'cut':
			wc?.cut();
			return;
		case 'copy':
			wc?.copy();
			return;
		case 'paste':
			wc?.paste();
			return;
		case 'selectAll':
			wc?.selectAll();
			return;
		case 'reload':
			wc?.reload();
			return;
		case 'forceReload':
			wc?.reloadIgnoringCache();
			return;
		case 'toggleDevTools':
			wc?.toggleDevTools();
			return;
		case 'resetZoom':
			wc?.setZoomLevel(0);
			return;
		case 'zoomIn':
			if (wc) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
			return;
		case 'zoomOut':
			if (wc) wc.setZoomLevel(wc.getZoomLevel() - 0.5);
			return;
		case 'toggleFullscreen':
			if (win) win.setFullScreen(!win.isFullScreen());
			return;
		case 'minimize':
			win?.minimize();
			return;
		case 'maximize':
			if (!win) return;
			if (win.isMaximized()) win.unmaximize();
			else win.maximize();
			return;
		case 'close':
			win?.close();
			return;
		case 'quit':
			app.quit();
			return;
	}
}

export function setupWindowChromeIpc(): void {
	ipcMain.handle('window:perform', (e, action: WindowChromeAction) => {
		performWindowChromeAction(e.sender, action);
	});
}
