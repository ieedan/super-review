import { app, BrowserWindow, ipcMain } from 'electron';
// electron-updater is CommonJS; under our ESM ("type": "module") main process
// the named exports aren't reliably interop'd, so import the default and
// destructure.
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '@shared/types.js';
import { webBase } from './license/service.js';

const { autoUpdater } = electronUpdater;

// How often to re-check for updates while the app stays open, on top of the
// once-on-launch check. Long-running windows otherwise never see a release
// until they're relaunched.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// Last status we pushed, so a window opened after a download already finished
// can seed its toast via updater:getStatus instead of missing the events.
let lastStatus: UpdateStatus = { state: 'idle' };

// The version being downloaded. `download-progress` events don't carry it, so we
// stash it from `update-available` to label the progress toast.
let pendingVersion = '';

// Dev-only: replay a whole fake update cycle so the toast can be seen without
// cutting a real release. Enabled by SUPER_REVIEW_SIMULATE_UPDATE (see
// runUpdateSimulation).
const SIMULATE_UPDATE = !!process.env['SUPER_REVIEW_SIMULATE_UPDATE'];

// Send to a window only when its render frame is alive; a disposed frame throws
// from webContents.send. A dropped event is harmless — new windows re-seed via
// updater:getStatus. Mirrors ipc.ts's sendToWindow.
function pushStatus(status: UpdateStatus): void {
	lastStatus = status;
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) continue;
		const wc = win.webContents;
		if (wc.isDestroyed() || wc.isCrashed()) continue;
		try {
			wc.send('updater:status', status);
		} catch {
			/* frame disposed mid-send — drop the event */
		}
	}
}

// Bumped each time a simulation starts so a re-trigger cancels the in-flight
// one instead of interleaving two timelines.
let simulationToken = 0;

// Dev-only: push the notice through checking → downloading (ramping) →
// downloaded using the REAL pushStatus pipeline (IPC → preload → store →
// CommitNotices), so what you see is exactly the production path, just with fake
// data. Runs on
// launch when SUPER_REVIEW_SIMULATE_UPDATE is set, and can be replayed on demand
// from the renderer devtools console with `window.api.updater.check()`.
function runUpdateSimulation(): void {
	const token = ++simulationToken;
	const version = '9.9.9';
	const total = 84 * 1024 * 1024; // 84 MB
	const speed = 6 * 1024 * 1024; // 6 MB/s

	const frames: UpdateStatus[] = [{ state: 'checking' }, { state: 'available', version }];
	for (let percent = 0; percent <= 100; percent += 4) {
		frames.push({
			state: 'downloading',
			version,
			percent,
			bytesPerSecond: speed,
			transferred: Math.round((percent / 100) * total),
			total
		});
	}
	frames.push({ state: 'downloaded', version });

	pendingVersion = version;
	let i = 0;
	const tick = (): void => {
		if (token !== simulationToken) return; // superseded by a newer run
		if (i >= frames.length) return; // hold on the final `downloaded` frame
		pushStatus(frames[i++]);
		setTimeout(tick, 350);
	};
	tick();
}

// Wire up auto-updates against our own update feed. electron-builder publishes
// the installers + latest*.yml to a *private* GitHub Release, which installed
// copies can't read directly. Instead we point electron-updater at the web
// app's generic feed (apps/web /api/update/*), which proxies those private
// assets with a server-side token. See apps/web/src/routes/api/update/[file].
//
// No-op in dev: there's no packaged app to replace and no update metadata, so
// electron-updater would only log "checkForUpdates called, ... app is not
// packaged" noise.
export function initAutoUpdates(): void {
	// The renderer talks to these regardless of packaging so the wiring is
	// uniform; they just resolve to idle / no-op in dev.
	ipcMain.handle('updater:getVersion', () => app.getVersion());
	ipcMain.handle('updater:getStatus', () => lastStatus);
	ipcMain.handle('updater:check', () => {
		// In dev with the simulation flag, `check` replays the fake cycle so you
		// can re-watch the toast from the devtools console.
		if (SIMULATE_UPDATE && !app.isPackaged) return runUpdateSimulation();
		if (app.isPackaged) void autoUpdater.checkForUpdates();
	});
	ipcMain.handle('updater:quitAndInstall', () => {
		// isSilent=true (1st arg): on Windows this runs the NSIS installer with its
		// silent flags (/S). Our installer is the assisted (oneClick: false) kind so
		// fresh installs still get the wizard, but a silent update reuses the install
		// directory and per-user choice recorded on first install, swapping the
		// binary in place with no wizard. Per-user (perMachine: false) means no UAC
		// prompt either. On macOS electron-updater ignores isSilent (Squirrel.Mac has
		// no such notion), so passing true is a no-op there and needs no platform
		// branch.
		//
		// isForceRunAfter=true (2nd arg) so a manual "Restart" relaunches the app
		// (the default only relaunches on Windows).
		if (app.isPackaged) autoUpdater.quitAndInstall(true, true);
	});

	if (!app.isPackaged) {
		// Kick off the fake cycle once on launch (delayed so the window's renderer
		// has mounted and subscribed to updater:status first).
		if (SIMULATE_UPDATE) setTimeout(runUpdateSimulation, 2500);
		return;
	}

	// Read the feed from our proxy rather than the private GitHub repo the build
	// was published to. Overrides the github provider baked into app-update.yml.
	// Trailing slash so electron-updater resolves `latest-mac.yml` and the
	// artifacts it names *under* /api/update/, not as siblings of it.
	autoUpdater.setFeedURL({ provider: 'generic', url: `${webBase()}/api/update/` });

	// Download in the background and swap the binary on the next quit. macOS
	// updates require a signed build; an unsigned app logs an error here and
	// keeps running rather than crashing.
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	// Differential (blockmap) downloads issue many small HTTP range requests. Our
	// proxy answers each with a fresh redirect to a short-lived signed URL, which
	// is fragile across a long download and hammers the GitHub API. A single
	// full-file download through one redirect is far more robust, and desktop
	// installer deltas aren't worth that risk.
	autoUpdater.disableDifferentialDownload = true;

	autoUpdater.on('checking-for-update', () => pushStatus({ state: 'checking' }));
	autoUpdater.on('update-available', (info) => {
		pendingVersion = info.version;
		pushStatus({ state: 'available', version: info.version });
	});
	autoUpdater.on('update-not-available', () => pushStatus({ state: 'idle' }));
	autoUpdater.on('download-progress', (p) =>
		pushStatus({
			state: 'downloading',
			version: pendingVersion,
			percent: Math.round(p.percent),
			bytesPerSecond: p.bytesPerSecond,
			transferred: p.transferred,
			total: p.total
		})
	);
	autoUpdater.on('update-downloaded', (info) =>
		pushStatus({ state: 'downloaded', version: info.version })
	);
	autoUpdater.on('error', (err) => {
		console.error('[updater] update check failed:', err);
		pushStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
	});

	void autoUpdater.checkForUpdates();
	setInterval(() => void autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
}
