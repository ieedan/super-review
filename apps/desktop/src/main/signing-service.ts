import { app } from 'electron';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Per-account ed25519 SSH signing keys live under the app's user-data dir — not
// ~/.ssh, so they're never offered as authentication keys and don't pollute the
// user's own setup. The keys carry no passphrase on purpose: a passphrase would
// force an ssh-agent / pinentry dependency at commit time, which defeats the
// whole point of zero-setup, signed-by-default commits.
function signingDir(): string {
	return path.join(app.getPath('userData'), 'signing');
}

// The private-key path; ssh-keygen writes the public key to `${keyPath}.pub`.
function keyPathFor(accountId: string): string {
	return path.join(signingDir(), `${accountId}_ed25519`);
}

// Ensure a signing key exists for the account and return its private-key path.
// Idempotent: an existing key is reused. Returns null when key generation isn't
// possible (e.g. ssh-keygen missing) so callers degrade to unsigned commits
// rather than failing.
export async function ensureSigningKey(accountId: string, login: string): Promise<string | null> {
	const keyPath = keyPathFor(accountId);
	try {
		await fs.access(keyPath);
		return keyPath;
	} catch {
		// Not generated yet — fall through and create it.
	}
	try {
		// mode 0700: the dir (and the private key below) are readable only by the
		// user, matching ~/.ssh conventions.
		await fs.mkdir(signingDir(), { recursive: true, mode: 0o700 });
		await execFileAsync('ssh-keygen', [
			'-t',
			'ed25519',
			'-f',
			keyPath,
			'-N',
			'', // empty passphrase
			'-C',
			`super-review ${login}`,
			'-q'
		]);
		await fs.chmod(keyPath, 0o600).catch(() => {});
		return keyPath;
	} catch {
		return null;
	}
}

// The OpenSSH-format public key (`ssh-ed25519 AAAA… comment`) for an account's
// signing key, or null if it hasn't been provisioned. Used to register the key
// with GitHub so signed commits verify.
export async function readSigningPublicKey(accountId: string): Promise<string | null> {
	try {
		return (await fs.readFile(`${keyPathFor(accountId)}.pub`, 'utf8')).trim();
	} catch {
		return null;
	}
}

// Remove an account's signing key pair (both private and public). Called when an
// account is removed so we don't leave orphaned keys behind.
export async function removeSigningKey(accountId: string): Promise<void> {
	const keyPath = keyPathFor(accountId);
	await fs.rm(keyPath, { force: true }).catch(() => {});
	await fs.rm(`${keyPath}.pub`, { force: true }).catch(() => {});
}
