import { app, BrowserWindow, ipcMain } from 'electron';
// electron-updater is CommonJS; under our ESM ("type": "module") main process
// the named exports aren't reliably interop'd, so import the default and
// destructure.
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '@super-review/core/types';

const { autoUpdater } = electronUpdater;

// The most recent status we broadcast. A renderer that mounts *after* the
// download finished (e.g. a second window, or a slow first paint) reads this via
// the `update:getStatus` IPC so it still shows the "update ready" notice.
let lastStatus: UpdateStatus = { state: 'idle' };

function setStatus(status: UpdateStatus): void {
	lastStatus = status;
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send('update:status', status);
	}
}

// Register the renderer-facing IPC regardless of packaging so the preload's
// `getStatus`/`quitAndInstall` calls always resolve (in dev the status just
// stays `idle` forever).
function registerUpdateIpc(): void {
	ipcMain.handle('update:getStatus', () => lastStatus);
	ipcMain.on('update:quitAndInstall', () => {
		// isSilent=false shows the OS installer UI on Windows; isForceRunAfter
		// relaunches the app after the update is applied. macOS ignores both.
		autoUpdater.quitAndInstall();
	});
}

// Wire up GitHub-backed auto-updates. The update feed (latest.yml /
// latest-mac.yml + installers) is published by electron-builder to GitHub
// Releases — see electron-builder.yml `publish` and the release workflow.
//
// The main process downloads a newer release in the background; the renderer
// shows an "update ready" notice (CommitNotices) once it's staged, and the user
// clicks to restart-and-install via `update:quitAndInstall`.
export function initAutoUpdates(): void {
	registerUpdateIpc();

	// No packaged app to replace and no update metadata in dev, so there's
	// nothing to check. The IPC above still answers with `idle`.
	if (!app.isPackaged) return;

	// Download the update in the background. The renderer's notice lets the user
	// restart-and-install immediately; if they don't, autoInstallOnAppQuit applies
	// the staged update the next time they quit anyway.
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
	autoUpdater.on('update-available', (info) =>
		setStatus({ state: 'available', version: info.version })
	);
	// Fired when the current build is already the latest — clear any stale notice.
	autoUpdater.on('update-not-available', () => setStatus({ state: 'idle' }));
	autoUpdater.on('download-progress', (progress) =>
		setStatus({
			state: 'downloading',
			version: autoUpdater.currentVersion?.version ?? '',
			percent: Math.round(progress.percent)
		})
	);
	autoUpdater.on('update-downloaded', (info) =>
		setStatus({ state: 'downloaded', version: info.version })
	);
	autoUpdater.on('error', (err) => {
		// macOS updates require a signed build; an unsigned app logs an error here
		// and keeps running rather than crashing. We surface it as an `error`
		// status (not shown in the UI today) and keep the app usable.
		console.error('[updater] update check failed:', err);
		setStatus({ state: 'error', message: err.message });
	});

	void autoUpdater.checkForUpdates();
}
