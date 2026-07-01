import { app, BrowserWindow, ipcMain, nativeImage, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fixPath from 'fix-path';
import { registerIpc } from './ipc.js';
import { registerGitCredentials } from './github-service.js';
import { setupAppMenu } from './menu.js';
import { initAutoUpdates } from './updater.js';
import { getPrefs, flushStore } from './store.js';
import { WINDOW_BOUNDS } from '@shared/types.js';

// macOS/Linux GUI launchers (Finder, Dock, Spotlight) start apps with a minimal
// PATH that excludes Homebrew, asdf, mise, etc. The git subprocesses we spawn —
// and the hooks they invoke, such as Git LFS's `pre-push` hook shelling out to
// `git-lfs` — inherit that stripped PATH and fail to find binaries the user has
// on their shell PATH. Re-derive the real PATH from the user's login shell
// before anything spawns. No-ops on Windows; harmless in dev (re-derives the
// same PATH a terminal launch already has).
fixPath();

// Set before the app menu is built so macOS shows our name (not "Electron") in
// the app menu and its About/Hide/Quit items. Matches electron-builder's
// productName so dev and packaged builds read the same.
app.setName('Super Review');

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

// Clamp a stored window dimension to its minimum, falling back to the default
// when the persisted value is missing or nonsensical (e.g. an old prefs file or
// a hand-edited 0). Keeps a bad value from producing a tiny, unusable window.
function windowDimension(value: number, min: number, fallback: number): number {
	if (!Number.isFinite(value) || value <= 0) return fallback;
	return Math.max(min, Math.floor(value));
}

function createWindow(): void {
	const prefs = getPrefs();
	const width = windowDimension(
		prefs.windowWidth,
		WINDOW_BOUNDS.minWidth,
		WINDOW_BOUNDS.defaultWidth
	);
	const height = windowDimension(
		prefs.windowHeight,
		WINDOW_BOUNDS.minHeight,
		WINDOW_BOUNDS.defaultHeight
	);
	const win = new BrowserWindow({
		width,
		height,
		minWidth: WINDOW_BOUNDS.minWidth,
		minHeight: WINDOW_BOUNDS.minHeight,
		// Open centered on the current display (we never restore a saved x/y, so
		// without this the OS could place it by cascade rather than centered).
		center: true,
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

	// width/height stay the window's restore bounds; maximizing before show means
	// the first paint is already at full size rather than flashing the small size.
	if (prefs.startMaximized) win.maximize();

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

// The dev-only in-app inspector (sv-agentation) copies annotations to the
// clipboard via navigator.clipboard.writeText, gated behind
// 'clipboard-sanitized-write'. Grant that; deny everything else this trusted
// local app never asks for. (Fonts are now bundled via Fontsource, so the Local
// Font Access API / 'local-fonts' permission is no longer needed.)
function setupPermissions(): void {
	const ses = session.defaultSession;
	// These aren't all in Electron's typed permission union yet, though they're
	// valid runtime values — compare as strings.
	const allowed = new Set(['clipboard-sanitized-write']);
	ses.setPermissionRequestHandler((_wc, permission, callback) => {
		callback(allowed.has(permission as string));
	});
	ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission as string));
}

void app.whenReady().then(() => {
	// macOS shows the dock icon from the app bundle; in dev there's no bundle, so
	// set it explicitly. No-op off macOS (app.dock is undefined there).
	if (isDev && process.platform === 'darwin') {
		const img = nativeImage.createFromPath(devIconPath);
		if (!img.isEmpty()) app.dock?.setIcon(img);
	}
	setupPermissions();
	registerGitCredentials();
	registerIpc();
	setupAppMenu();
	createWindow();
	initAutoUpdates();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

// Persist any debounced store write (the file-list cache) before exiting.
app.on('before-quit', () => {
	flushStore();
});
