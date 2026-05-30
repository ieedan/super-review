import { app, BrowserWindow, ipcMain, nativeImage, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc.js';
import { initAutoUpdates } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In dev the dock/taskbar would otherwise show the default Electron icon —
// packaged builds get their icon from electron-builder (build/icon.*), which
// isn't bundled here, so this is dev-only. Resolves to apps/desktop/build/.
const isDev = !!process.env['ELECTRON_RENDERER_URL'];
const devIconPath = path.join(__dirname, '../../build/icon.png');

// Geometry of the renderer's header (TopBar.svelte: `h-11`) and the macOS
// traffic-light buttons, which the OS draws at a fixed point size regardless of
// the renderer's zoom factor. To keep them centered in the header at every zoom
// level we recompute their position from the live zoom factor (see
// alignWindowButtons): the header occupies HEADER_HEIGHT * zoom points, while
// the buttons stay BUTTON_DIAMETER tall.
const HEADER_HEIGHT = 44; // h-11
const BUTTON_DIAMETER = 12; // macOS standard traffic-light height
const BUTTON_INSET_X = 19; // matches the default hiddenInset left inset at zoom 1
// Optical fine-tune of the vertical button position (points, at zoom 1).
// Negative moves the lights up, positive moves them down.
const BUTTON_OPTICAL_NUDGE_Y = -2;

function trafficLightPositionFor(zoom: number): { x: number; y: number } {
	// The header center scales with zoom (HEADER_HEIGHT * zoom / 2), but the
	// button keeps its fixed point size — so only the center term scales; the
	// half-button and optical nudge are constant.
	return {
		x: Math.round(BUTTON_INSET_X * zoom),
		y: Math.round((HEADER_HEIGHT * zoom) / 2 - BUTTON_DIAMETER / 2 + BUTTON_OPTICAL_NUDGE_Y)
	};
}

// Re-center the traffic lights for the window's current zoom factor. No-op off
// macOS, where the buttons aren't ours to position.
function alignWindowButtons(win: BrowserWindow): void {
	if (process.platform !== 'darwin' || win.isDestroyed()) return;
	win.setWindowButtonPosition(trafficLightPositionFor(win.webContents.getZoomFactor()));
}

function createWindow(): void {
	const win = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 720,
		minHeight: 480,
		show: false,
		titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
		// Baseline (zoom 1) so the buttons are centered on first paint; zoom changes
		// recompute this via alignWindowButtons.
		...(process.platform === 'darwin' ? { trafficLightPosition: trafficLightPositionFor(1) } : {}),
		backgroundColor: '#0a0a0a',
		// macOS ignores the window icon (it uses the dock/bundle icon, set below);
		// Windows/Linux pick up the window + taskbar icon from here in dev.
		...(isDev && process.platform !== 'darwin' ? { icon: devIconPath } : {}),
		webPreferences: {
			preload: path.join(__dirname, '../preload/index.mjs'),
			contextIsolation: true,
			sandbox: false,
			nodeIntegration: false
		}
	});

	win.once('ready-to-show', () => win.show());

	// Keep the traffic lights centered in the header as the zoom factor changes.
	// 'zoom-changed' covers trackpad/ctrl-scroll zoom; keyboard/menu zoom doesn't
	// emit it, so the renderer also pings us via 'window:syncControls'.
	win.webContents.on('zoom-changed', () => alignWindowButtons(win));
	ipcMain.on('window:syncControls', (e) => {
		if (e.sender === win.webContents) alignWindowButtons(win);
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: 'deny' };
	});

	if (process.env['ELECTRON_RENDERER_URL']) {
		void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
	} else {
		void win.loadFile(path.join(__dirname, '../renderer/index.html'));
	}
}

// The Appearance settings enumerate installed fonts via the renderer's Local
// Font Access API (window.queryLocalFonts), which is gated behind the
// 'local-fonts' permission. Grant it; deny everything else this trusted local
// app never asks for.
function setupPermissions(): void {
	const ses = session.defaultSession;
	// 'local-fonts' isn't in Electron's typed permission union yet, though it's
	// a valid runtime value — compare as a string.
	ses.setPermissionRequestHandler((_wc, permission, callback) => {
		callback((permission as string) === 'local-fonts');
	});
	ses.setPermissionCheckHandler((_wc, permission) => (permission as string) === 'local-fonts');
}

void app.whenReady().then(() => {
	// macOS shows the dock icon from the app bundle; in dev there's no bundle, so
	// set it explicitly. No-op off macOS (app.dock is undefined there).
	if (isDev && process.platform === 'darwin') {
		const img = nativeImage.createFromPath(devIconPath);
		if (!img.isEmpty()) app.dock?.setIcon(img);
	}
	setupPermissions();
	registerIpc();
	createWindow();
	initAutoUpdates();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
