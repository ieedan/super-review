/**
 * License IPC allowlist + skip marker shared by the main-process gate and the
 * preload soft-gate. Channels not on this list require an unlocked license.
 */

export const LICENSE_GATE_CODE = 'UNLICENSED';
export const LICENSE_GATE_MESSAGE = 'A valid Super Review license is required.';

/** Namespaces usable while the app is NOT licensed. */
export const LICENSE_ALLOWED_NAMESPACES = ['license:', 'window:'] as const;

/** Exact channels usable while the app is NOT licensed. */
export const LICENSE_ALLOWED_EXACT = new Set([
	// Read-only pref fetch so the lock screen can honor theme/zoom.
	'state:getPrefs'
]);

export function isLicenseAllowedChannel(channel: string): boolean {
	if (LICENSE_ALLOWED_EXACT.has(channel)) return true;
	return LICENSE_ALLOWED_NAMESPACES.some((ns) => channel.startsWith(ns));
}

/** Thrown by the main gate (and mirrored by preload) when a gated channel is
 * invoked while locked. Callers must treat this as silent, never user-facing. */
export class LicenseGateError extends Error {
	code = LICENSE_GATE_CODE;
	constructor() {
		super(LICENSE_GATE_MESSAGE);
		this.name = 'LicenseGateError';
	}
}

export function isLicenseGateError(err: unknown): boolean {
	if (err instanceof LicenseGateError) return true;
	if (err && typeof err === 'object') {
		const e = err as { name?: string; code?: string; message?: string };
		if (e.name === 'LicenseGateError' || e.code === LICENSE_GATE_CODE) return true;
		if (typeof e.message === 'string' && isLicenseGateMessage(e.message)) return true;
	}
	if (typeof err === 'string' && isLicenseGateMessage(err)) return true;
	return false;
}

export function isLicenseGateMessage(message: string): boolean {
	return (
		message.includes(LICENSE_GATE_MESSAGE) ||
		message.includes('LicenseGateError') ||
		message.includes('LicenseGateSkip')
	);
}
