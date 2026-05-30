import { app } from 'electron';
// electron-updater is CommonJS; under our ESM ("type": "module") main process
// the named exports aren't reliably interop'd, so import the default and
// destructure.
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

// Wire up GitHub-backed auto-updates. The update feed (latest.yml /
// latest-mac.yml + installers) is published by electron-builder to GitHub
// Releases — see electron-builder.yml `publish` and PUBLISHING.md.
//
// No-op in dev: there's no packaged app to replace and no update metadata, so
// electron-updater would only log "checkForUpdates called, ... app is not
// packaged" noise.
export function initAutoUpdates(): void {
	if (!app.isPackaged) return;

	// Download in the background and swap the binary on the next quit. macOS
	// updates require a signed build; an unsigned app logs an error here and
	// keeps running rather than crashing.
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on('error', (err) => {
		console.error('[updater] update check failed:', err);
	});

	void autoUpdater.checkForUpdatesAndNotify();
}
