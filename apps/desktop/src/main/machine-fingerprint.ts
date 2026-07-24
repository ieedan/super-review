import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { getFallbackFingerprint, setFallbackFingerprint } from './store.js';

const execFileAsync = promisify(execFile);

export type FingerprintSource = 'os' | 'fallback';

export interface MachineFingerprint {
	// sha256('super-review:' + rawId) - salted so our id can't be correlated with
	// other apps' hashed machine ids.
	value: string;
	source: FingerprintSource;
}

let cached: MachineFingerprint | null = null;

async function readRawOsId(): Promise<string | null> {
	try {
		if (process.platform === 'darwin') {
			const { stdout } = await execFileAsync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
			const match = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
			return match?.[1] ?? null;
		}
		if (process.platform === 'win32') {
			const { stdout } = await execFileAsync('reg', [
				'query',
				'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
				'/v',
				'MachineGuid'
			]);
			const match = stdout.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
			return match?.[1] ?? null;
		}
		// linux + others
		for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
			try {
				const id = fs.readFileSync(path, 'utf8').trim();
				if (id) return id;
			} catch {
				// try the next source
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * A stable per-machine fingerprint, resolved once per process. Falls back to a
 * persisted random UUID when no OS source is readable (containers, hardened
 * Linux); the `source` is reported to the server so it can apply looser device
 * limits to fallback ids.
 *
 * Stability notes: an OS reinstall yields a new id (a new device slot server
 * side, acceptable); cloned VMs share one id (server sees one device);
 * dual-boot counts as two devices.
 */
export async function getMachineFingerprint(): Promise<MachineFingerprint> {
	if (cached) return cached;
	const rawOs = await readRawOsId();
	if (rawOs) {
		cached = { value: hash(rawOs), source: 'os' };
		return cached;
	}
	let fallback = getFallbackFingerprint();
	if (!fallback) {
		fallback = crypto.randomUUID();
		setFallbackFingerprint(fallback);
	}
	cached = { value: hash(fallback), source: 'fallback' };
	return cached;
}

function hash(rawId: string): string {
	return crypto
		.createHash('sha256')
		.update('super-review:' + rawId)
		.digest('hex');
}
