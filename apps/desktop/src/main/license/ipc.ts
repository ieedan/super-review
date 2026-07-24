import { ipcMain, shell } from 'electron';
import type { ActivationStatus, LicenseState } from '@shared/types.js';
import {
	getLicenseState,
	startActivation,
	pollActivation,
	cancelActivation,
	openVerificationPage,
	signOut,
	revalidateOnline,
	getPricingUrl,
	getDashboardUrl
} from './service.js';

// Registered from registerIpc(). These channels are on the IPC gate allowlist
// (license:*), so they work while the app is locked.
export function registerLicenseIpc(): void {
	ipcMain.handle('license:getStatus', async (): Promise<LicenseState> => getLicenseState());

	ipcMain.handle(
		'license:startActivation',
		async (): Promise<{ userCode: string; verificationUri: string }> => startActivation()
	);

	ipcMain.handle('license:pollActivation', async (): Promise<ActivationStatus> => pollActivation());

	ipcMain.handle('license:cancelActivation', async (): Promise<void> => cancelActivation());

	ipcMain.handle('license:openVerification', async (): Promise<void> => openVerificationPage());

	ipcMain.handle('license:recheck', async (): Promise<LicenseState> => {
		await revalidateOnline();
		return getLicenseState();
	});

	ipcMain.handle('license:signOut', async (): Promise<void> => signOut());

	// The pricing URL is a main-process constant; the renderer can't influence
	// the destination (so shell:* stays blocked by the gate).
	ipcMain.handle('license:openPricing', async (): Promise<void> => {
		await shell.openExternal(getPricingUrl());
	});

	// Same deal as openPricing: a fixed main-process URL, so this stays usable
	// while the app is locked without opening up shell:*.
	ipcMain.handle('license:openDashboard', async (): Promise<void> => {
		await shell.openExternal(getDashboardUrl());
	});
}
