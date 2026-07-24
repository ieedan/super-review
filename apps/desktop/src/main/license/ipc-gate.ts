import { ipcMain } from 'electron';
import { isLicenseAllowedChannel, LicenseGateError } from '../../shared/license-ipc.js';
import { isUnlocked } from './service.js';

let installed = false;

/**
 * Wraps ipcMain.handle/on ONCE, before any handlers register, so every one of
 * the ~169 existing handlers is gated with zero per-handler edits. The check
 * runs per-invocation against live license state, so unlocking flips everything
 * on without re-registration.
 */
export function installLicenseIpcGate(): void {
	if (installed) return;
	installed = true;

	const realHandle = ipcMain.handle.bind(ipcMain);
	ipcMain.handle = ((channel: string, listener: (...args: unknown[]) => unknown) => {
		return realHandle(channel, (event, ...args) => {
			if (!isLicenseAllowedChannel(channel) && !isUnlocked()) throw new LicenseGateError();
			return (listener as (e: unknown, ...a: unknown[]) => unknown)(event, ...args);
		});
	}) as typeof ipcMain.handle;

	const realOn = ipcMain.on.bind(ipcMain);
	ipcMain.on = ((channel: string, listener: (...args: unknown[]) => void) => {
		return realOn(channel, (event, ...args) => {
			if (!isLicenseAllowedChannel(channel) && !isUnlocked()) return;
			(listener as (e: unknown, ...a: unknown[]) => void)(event, ...args);
		});
	}) as typeof ipcMain.on;
}
