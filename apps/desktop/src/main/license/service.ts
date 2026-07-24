import { app, shell, powerMonitor, BrowserWindow } from 'electron';
import os from 'node:os';
import { licenseClaimsToState } from '@super-review/core/license-claims';
import type { ActivationStatus, LicenseState } from '@shared/types.js';
import {
	getLicenseSlice,
	getDeviceToken,
	setDeviceToken,
	setCachedLicenseToken,
	setLastValidation,
	bumpWallClock
} from '../store.js';
import { getMachineFingerprint } from '../machine-fingerprint.js';
import { verifyLicenseToken } from './token.js';
import { ensureLicenseWatch, stopLicenseWatch } from './watch.js';

// The companion web app. Overridable only in dev so a packaged build can't be
// pointed at a rogue server via env.
const DEFAULT_WEB_BASE = 'https://superreview.dev';
export function webBase(): string {
	if (!app.isPackaged && process.env['SUPER_REVIEW_API_URL']) {
		return process.env['SUPER_REVIEW_API_URL'].replace(/\/$/, '');
	}
	return DEFAULT_WEB_BASE;
}

const REVALIDATE_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8h
const CACHE_RECHECK_INTERVAL_MS = 15 * 60 * 1000; // 15min
const WALLCLOCK_HEARTBEAT_MS = 10 * 60 * 1000; // 10min
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000; // 5min
const MIN_POLL_INTERVAL_MS = 1500;

let current: LicenseState = { state: 'unlicensed' };
let clockSuspect = false;

// In-progress device-code activation: the secret device code we poll with, when
// it stops being valid, and the background poll timer.
interface PendingActivation {
	deviceCode: string;
	verificationUri: string;
	expiresAt: number;
	pollTimer: NodeJS.Timeout | null;
}
let pending: PendingActivation | null = null;
let activationStatus: ActivationStatus = { state: 'idle' };

let revalidateTimer: NodeJS.Timeout | null = null;
let recheckTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

export function getLicenseState(): LicenseState {
	return current;
}

/** True while the app should be usable (trialing counts). The IPC gate reads
 * this. */
export function isUnlocked(): boolean {
	return current.state === 'licensed';
}

export function getPricingUrl(): string {
	// The dedicated pricing page. Uses webBase() so dev points at the local site;
	// still a main-process value the renderer can't influence.
	return `${webBase()}/pricing`;
}

export function getDashboardUrl(): string {
	// Where the license, billing, and activated devices are managed. Same
	// main-process-only rule as getPricingUrl().
	return `${webBase()}/dashboard`;
}

function broadcast(): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) continue;
		const wc = win.webContents;
		// A window can be alive while its render frame is transiently disposed
		// (reload / crash / early startup); `send` then throws "Render frame was
		// disposed". The renderer re-pulls license status on load, so a dropped push
		// is harmless — guard and swallow rather than let it throw.
		if (wc.isDestroyed() || wc.isCrashed()) continue;
		try {
			wc.send('license:changed', current);
		} catch {
			/* frame disposed mid-send */
		}
	}
}

function setState(next: LicenseState): void {
	const changed = JSON.stringify(next) !== JSON.stringify(current);
	current = next;
	if (changed) broadcast();
}

/** Offline-verify the cached token and map it to a state. */
async function stateFromCache(): Promise<LicenseState> {
	const { cachedLicenseToken } = getLicenseSlice();
	if (!cachedLicenseToken) return { state: 'unlicensed' };
	const claims = verifyLicenseToken(cachedLicenseToken);
	if (!claims) return { state: 'unlicensed' };
	const fp = await getMachineFingerprint();
	return licenseClaimsToState(claims, Date.now(), fp.value);
}

/**
 * Synchronous-ish startup evaluation, awaited in whenReady before the window is
 * created. Reads the cached token, checks for clock rollback, and sets the
 * initial state entirely offline. The online revalidation happens after the
 * window exists.
 */
export async function initLicenseService(): Promise<void> {
	const slice = getLicenseSlice();
	const now = Date.now();

	// Clock-rollback check: if the clock is earlier than the last heartbeat, the
	// cached token's expiry can't be trusted until an online check succeeds.
	if (slice.lastSeenWallClock && now < slice.lastSeenWallClock - CLOCK_ROLLBACK_TOLERANCE_MS) {
		clockSuspect = true;
	}

	if (!getDeviceToken()) {
		setState({ state: 'unlicensed' });
	} else if (clockSuspect) {
		setState({ state: 'locked', reason: 'clock_rollback' });
	} else {
		setState(await stateFromCache());
	}

	bumpWallClock(now);
	heartbeatTimer = setInterval(() => bumpWallClock(Date.now()), WALLCLOCK_HEARTBEAT_MS);
}

/** Start background timers and kick the first online validation. Called after
 * the window exists. */
export function startLicenseBackgroundWork(): void {
	void revalidateOnline();
	revalidateTimer = setInterval(() => void revalidateOnline(), REVALIDATE_INTERVAL_MS);
	// Catch in-session cache expiry (long-running app that goes offline > 72h).
	recheckTimer = setInterval(() => void recheckCache(), CACHE_RECHECK_INTERVAL_MS);
	powerMonitor.on('resume', () => void revalidateOnline());
	// Refresh when the user returns to the app - e.g. right after upgrading in the
	// browser - so a new plan shows up without waiting for the 8h timer. Throttled
	// so alt-tabbing doesn't spam the server.
	app.on('browser-window-focus', () => void revalidateOnFocus());
}

const FOCUS_REVALIDATE_THROTTLE_MS = 30 * 1000;
let lastFocusRevalidateAt = 0;
async function revalidateOnFocus(): Promise<void> {
	const now = Date.now();
	if (now - lastFocusRevalidateAt < FOCUS_REVALIDATE_THROTTLE_MS) return;
	lastFocusRevalidateAt = now;
	await revalidateOnline();
}

async function recheckCache(): Promise<void> {
	if (current.state !== 'licensed') return;
	const next = await stateFromCache();
	setState(next);
}

/**
 * Online validation. On success, verifies the returned token against the
 * embedded key BEFORE accepting it (never trusts the transport). Definitive
 * server verdicts lock; network errors keep the current state (the cached
 * token's expiry is the offline budget). A network response can lock, never
 * unlock.
 */
export async function revalidateOnline(): Promise<void> {
	const deviceToken = getDeviceToken();
	if (!deviceToken) {
		setState({ state: 'unlicensed' });
		return;
	}
	const fp = await getMachineFingerprint();
	let res: Response;
	try {
		res = await fetch(`${webBase()}/api/license/validate`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${deviceToken}`
			},
			body: JSON.stringify({
				fingerprint: fp.value,
				platform: process.platform,
				appVersion: app.getVersion()
			})
		});
	} catch {
		// Offline: keep the current state; the cached token expiry governs.
		return;
	}

	if (res.status === 401) {
		// Device token revoked / invalid: clear and lock.
		stopLicenseWatch();
		setDeviceToken(null);
		setCachedLicenseToken(null);
		setState({ state: 'locked', reason: 'revoked' });
		return;
	}

	let body: {
		ok?: boolean;
		reason?: string;
		licenseToken?: string;
		serverTime?: number;
		convexUrl?: string;
	};
	try {
		body = (await res.json()) as typeof body;
	} catch {
		return;
	}

	// Open the realtime watch as soon as we have a live device token, whatever the
	// verdict - so even a locked app (expired trial, lapsed sub) unlocks the
	// instant a purchase lands, without waiting for the next poll.
	startLicenseWatch(body.convexUrl);

	if (body.ok && body.licenseToken) {
		// Verify against the embedded key before trusting anything.
		const claims = verifyLicenseToken(body.licenseToken);
		if (!claims) return; // a server that can't produce a valid signature can't unlock us
		setCachedLicenseToken(body.licenseToken);
		if (typeof body.serverTime === 'number') setLastValidation(body.serverTime);
		clockSuspect = false;
		setState(licenseClaimsToState(claims, Date.now(), fp.value));
		return;
	}

	// Definitive denial - a lock signal only.
	if (body.reason) {
		setCachedLicenseToken(null);
		setState(mapDenial(body.reason));
	}
}

/**
 * Subscribe to license changes for the current device over Convex's websocket,
 * revalidating the moment a change is pushed. The subscription is a nudge only:
 * it never unlocks by itself - it just triggers revalidateOnline(), which stays
 * the sole path to a signed token. Idempotent, so calling it after every
 * validation is cheap.
 */
function startLicenseWatch(convexUrl: string | undefined): void {
	const deviceToken = getDeviceToken();
	if (!convexUrl || !deviceToken) return;
	ensureLicenseWatch(convexUrl, deviceToken, () => void revalidateOnline());
}

function mapDenial(reason: string): LicenseState {
	switch (reason) {
		case 'waitlist':
			return { state: 'locked', reason: 'waitlist' };
		case 'trial_expired':
			return { state: 'locked', reason: 'trial_expired' };
		case 'subscription_lapsed':
			return { state: 'locked', reason: 'subscription_lapsed' };
		case 'suspended':
			return { state: 'locked', reason: 'suspended' };
		case 'fingerprint_mismatch':
			return { state: 'locked', reason: 'fingerprint_mismatch' };
		case 'device_revoked':
		case 'invalid_token':
			return { state: 'locked', reason: 'revoked' };
		case 'no_license':
		default:
			return { state: 'unlicensed' };
	}
}

// --- Activation flow (device authorization grant) ---------------------------

interface StartResponse {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	expiresAt: number;
	intervalMs: number;
}

/**
 * Requests a device code from the server, opens the browser to the verification
 * page, and starts polling in the background. Returns the user code to display
 * and where the user enters it.
 */
export async function startActivation(): Promise<{ userCode: string; verificationUri: string }> {
	cancelActivation();
	const fp = await getMachineFingerprint();

	let res: Response;
	try {
		res = await fetch(`${webBase()}/api/activation/start`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				fingerprint: fp.value,
				fingerprintSource: fp.source,
				platform: process.platform,
				appVersion: app.getVersion(),
				machineName: hostnameLabel()
			})
		});
	} catch {
		const message = 'Could not reach the server';
		activationStatus = { state: 'error', message };
		throw new Error(message);
	}
	if (!res.ok) {
		const message =
			res.status === 429 ? 'Too many attempts. Try again later.' : 'Could not start activation';
		activationStatus = { state: 'error', message };
		throw new Error(message);
	}

	const body = (await res.json()) as StartResponse;
	pending = {
		deviceCode: body.deviceCode,
		verificationUri: body.verificationUri,
		expiresAt: body.expiresAt,
		pollTimer: null
	};
	activationStatus = {
		state: 'waiting',
		userCode: body.userCode,
		verificationUri: body.verificationUri
	};

	void shell.openExternal(body.verificationUri);

	const interval = Math.max(MIN_POLL_INTERVAL_MS, body.intervalMs || 3000);
	pending.pollTimer = setInterval(() => void pollServer(), interval);

	return { userCode: body.userCode, verificationUri: body.verificationUri };
}

/** One server poll: reports pending / denied / expired, or applies the tokens
 * once approved. */
async function pollServer(): Promise<void> {
	if (!pending) return;
	if (Date.now() > pending.expiresAt) {
		stopActivationPolling();
		activationStatus = { state: 'error', message: 'The code expired. Start again.' };
		return;
	}

	const deviceCode = pending.deviceCode;
	const fp = await getMachineFingerprint();
	let res: Response;
	try {
		res = await fetch(`${webBase()}/api/activation/poll`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				deviceCode,
				fingerprint: fp.value,
				fingerprintSource: fp.source,
				platform: process.platform,
				appVersion: app.getVersion(),
				machineName: hostnameLabel()
			})
		});
	} catch {
		return; // transient network error: keep polling until expiry
	}
	if (!res.ok) {
		if (res.status === 429) return; // our interval already backs off
		stopActivationPolling();
		activationStatus = { state: 'error', message: 'Activation failed' };
		return;
	}

	let body: {
		status?: string;
		ok?: boolean;
		reason?: string;
		deviceToken?: string;
		licenseToken?: string;
		serverTime?: number;
		convexUrl?: string;
	};
	try {
		body = (await res.json()) as typeof body;
	} catch {
		return;
	}

	if (body.status === 'pending') return;
	if (body.status === 'denied') {
		stopActivationPolling();
		activationStatus = { state: 'denied' };
		return;
	}
	if (body.status === 'approved') {
		stopActivationPolling();
		await applyActivation(body, fp.value);
		return;
	}
	// 'expired' or anything unexpected.
	stopActivationPolling();
	activationStatus = { state: 'error', message: 'The code expired. Start again.' };
}

async function applyActivation(
	body: {
		ok?: boolean;
		reason?: string;
		deviceToken?: string;
		licenseToken?: string;
		serverTime?: number;
		convexUrl?: string;
	},
	fingerprint: string
): Promise<void> {
	if (!body.deviceToken) {
		activationStatus = { state: 'error', message: 'Activation failed' };
		return;
	}
	// Store the long-lived device token regardless of the current license verdict
	// so periodic revalidation can pick it up later.
	setDeviceToken(body.deviceToken);

	// Start watching for license changes right away, so a plan bought moments
	// after activation shows up without waiting for the first poll.
	startLicenseWatch(body.convexUrl);

	if (body.ok && body.licenseToken) {
		const claims = verifyLicenseToken(body.licenseToken);
		if (claims) {
			setCachedLicenseToken(body.licenseToken);
			if (typeof body.serverTime === 'number') setLastValidation(body.serverTime);
			clockSuspect = false;
			setState(licenseClaimsToState(claims, Date.now(), fingerprint));
		}
	} else if (body.reason) {
		setState(mapDenial(body.reason));
	}

	activationStatus = { state: 'success', license: current };
}

export function pollActivation(): ActivationStatus {
	return activationStatus;
}

/** Re-open the verification page for the in-progress activation. The URL is the
 * main-process copy, so the renderer can't redirect it. */
export function openVerificationPage(): void {
	if (pending) void shell.openExternal(pending.verificationUri);
}

export function cancelActivation(): void {
	stopActivationPolling();
	if (activationStatus.state === 'waiting') activationStatus = { state: 'idle' };
}

function stopActivationPolling(): void {
	if (pending?.pollTimer) clearInterval(pending.pollTimer);
	pending = null;
}

/** Sign out: best-effort server revocation, then clear local credentials. */
export async function signOut(): Promise<void> {
	stopLicenseWatch();
	const deviceToken = getDeviceToken();
	if (deviceToken) {
		try {
			await fetch(`${webBase()}/api/device/logout`, {
				method: 'POST',
				headers: { authorization: `Bearer ${deviceToken}` }
			});
		} catch {
			// best effort
		}
	}
	setDeviceToken(null);
	setCachedLicenseToken(null);
	setState({ state: 'unlicensed' });
}

export function disposeLicenseService(): void {
	if (revalidateTimer) clearInterval(revalidateTimer);
	if (recheckTimer) clearInterval(recheckTimer);
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	stopLicenseWatch();
}

function hostnameLabel(): string {
	try {
		return os.hostname();
	} catch {
		return 'this device';
	}
}
