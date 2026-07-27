import { BrowserWindow } from 'electron';

// Height of the Windows custom menu bar (AppMenuBar.svelte). Must match the
// titleBarOverlay height so the native min/max/close buttons sit on that row.
export const MENU_BAR_HEIGHT = 30;

// Theme-matched Window Controls Overlay colors. Kept in sync with the
// renderer's `--color-background` (light = white, dark = hsl(0 0% 6%)).
export function titleBarOverlayFor(theme: 'light' | 'dark'): {
	color: string;
	symbolColor: string;
	height: number;
} {
	if (theme === 'light') {
		return { color: '#ffffff', symbolColor: '#1a1a1a', height: MENU_BAR_HEIGHT };
	}
	return { color: '#0f0f0f', symbolColor: '#a3a3a3', height: MENU_BAR_HEIGHT };
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
