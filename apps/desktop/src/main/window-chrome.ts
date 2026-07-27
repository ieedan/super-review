import { BrowserWindow } from 'electron';

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
