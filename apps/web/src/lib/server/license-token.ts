import { createPrivateKey, createHash, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK } from 'jose';
import { env } from '$lib/env.server';

const ISSUER = 'https://superreview.dev';
const AUDIENCE = 'super-review-desktop';
const TOKEN_TTL_SEC = 72 * 60 * 60;

function privateKey() {
	// ED25519_PRIVATE_KEY is base64 PKCS#8 DER (see generate-license-keys.mjs).
	return createPrivateKey({
		key: Buffer.from(env.ED25519_PRIVATE_KEY, 'base64'),
		format: 'der',
		type: 'pkcs8'
	});
}

export interface LicenseClaims {
	userId: string;
	licenseId: string;
	deviceId: string;
	plan: string;
	status: 'active' | 'trialing';
	/**
	 * The device's machine fingerprint, embedded verbatim. This is already the
	 * salted hash the desktop computes and compares against locally (sha256 of
	 * 'super-review:' + the OS machine id) - do NOT hash it again here, or the
	 * desktop's `claims.fp === localFingerprint` check can never match.
	 */
	fingerprint: string;
	/** trialEndsAt / currentPeriodEnd / null (lifetime) - for UI display only. */
	displayExpiresAt: number | null;
	/** When the paid plan started (lifetime purchase / first subscription), so the
	 * desktop can show "Active since" on the license card. Display only. */
	activeSince: number | null;
	/** Display identity of the license holder. The desktop has no other way to
	 * know which account the license belongs to (its local GitHub sign-ins are a
	 * separate thing), so it rides along in the token. Display only. */
	holderName?: string | null;
	holderEmail?: string | null;
	holderImage?: string | null;
}

/** Signs the short-lived (72h) Ed25519 license token the desktop verifies
 * against its embedded public key. This is the ONLY unlock signal. */
export async function signLicenseToken(claims: LicenseClaims): Promise<string> {
	return new SignJWT({
		lic: claims.licenseId,
		dev: claims.deviceId,
		plan: claims.plan,
		sta: claims.status,
		fp: claims.fingerprint,
		tex: claims.displayExpiresAt,
		since: claims.activeSince,
		hn: claims.holderName ?? null,
		he: claims.holderEmail ?? null,
		hi: claims.holderImage ?? null
	})
		.setProtectedHeader({ alg: 'EdDSA', kid: env.ED25519_KID, typ: 'JWT' })
		.setIssuer(ISSUER)
		.setAudience(AUDIENCE)
		.setSubject(claims.userId)
		.setIssuedAt()
		.setJti(randomBytes(16).toString('hex'))
		.setExpirationTime(`${TOKEN_TTL_SEC}s`)
		.sign(privateKey());
}

/** Public JWK(s) for the desktop / rotation, served at /api/license/jwks. */
export async function publicJwks() {
	const { createPublicKey } = await import('node:crypto');
	const jwk = await exportJWK(createPublicKey(privateKey()));
	return { keys: [{ ...jwk, kid: env.ED25519_KID, use: 'sig', alg: 'EdDSA' }] };
}

export function sha256Hex(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

// Unambiguous alphabet for the human-typed user code: no 0/O/1/I/L. 32 symbols,
// so an 8-character code carries 40 bits of entropy (brute force is bounded by
// the per-user inspect rate limit).
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const USER_CODE_LENGTH = 8;

/** A random display code like "WXYZ-4K7M". Callers hash the normalized form. */
export function generateUserCode(): string {
	const bytes = randomBytes(USER_CODE_LENGTH);
	let out = '';
	for (let i = 0; i < USER_CODE_LENGTH; i++) {
		out += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
	}
	return out;
}

/** Canonical form the code is hashed under: uppercase, no separators. Must match
 * the desktop display and the browser's normalization before hashing. */
export function normalizeUserCode(raw: string): string {
	return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** "WXYZ4K7M" -> "WXYZ-4K7M" for display. */
export function formatUserCode(raw: string): string {
	const c = normalizeUserCode(raw);
	const mid = Math.ceil(c.length / 2);
	return `${c.slice(0, mid)}-${c.slice(mid)}`;
}

export function hashUserCode(raw: string): string {
	return sha256Hex(normalizeUserCode(raw));
}

export function hashIp(ip: string): string {
	return createHash('sha256')
		.update(env.IP_HASH_SALT + ':' + ip)
		.digest('hex');
}
