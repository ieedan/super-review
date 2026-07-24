import crypto from 'node:crypto';
import { parseLicenseClaims } from './license-claims.js';
import type { LicenseClaims } from './types.js';

// Node-only (uses node:crypto): imported by the desktop MAIN process, never the
// renderer. The renderer uses ./license-claims (pure) instead.

function b64urlToBuffer(input: string): Buffer {
	return Buffer.from(input, 'base64url');
}

/**
 * Verifies an Ed25519-signed license JWT against a map of `kid -> SPKI PEM`
 * public keys. Returns the decoded claims on success, or null on ANY failure.
 *
 * Pins `alg: EdDSA` (kills alg-confusion downgrade attacks) and requires a known
 * `kid`. Whether the resulting claims are acceptable (expiry, fingerprint) is a
 * separate question - see licenseClaimsToState.
 */
export function verifyEdDSAJwt(
	jwt: string,
	publicKeys: Record<string, string>
): LicenseClaims | null {
	const parts = jwt.split('.');
	if (parts.length !== 3) return null;
	const [headerB64, payloadB64, sigB64] = parts;

	let header: { alg?: unknown; kid?: unknown };
	try {
		header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
	} catch {
		return null;
	}
	if (header.alg !== 'EdDSA' || typeof header.kid !== 'string') return null;

	// Trimmed before the lookup because a key id is a bare identifier and the
	// server env it comes from is easy to pollute with a stray newline (a
	// "lk_63d406cf\n" once shipped in production and matched nothing here, so
	// every activation failed at the last step). Whitespace is not part of any
	// key id we issue, so this only ever matches the key it was going to match -
	// the signature check below is what actually decides.
	const pem = publicKeys[header.kid.trim()];
	if (!pem) return null;

	try {
		const ok = crypto.verify(
			null,
			Buffer.from(`${headerB64}.${payloadB64}`),
			crypto.createPublicKey(pem),
			b64urlToBuffer(sigB64)
		);
		if (!ok) return null;
	} catch {
		return null;
	}

	return parseLicenseClaims(b64urlToBuffer(payloadB64).toString('utf8'));
}
