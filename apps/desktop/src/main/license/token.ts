import { verifyEdDSAJwt } from '@super-review/core/license-verify';
import type { LicenseClaims } from '@shared/types.js';
import { LICENSE_PUBLIC_KEYS } from './public-key.js';

/**
 * Verifies an Ed25519-signed license JWT against the embedded public key(s).
 * Returns the decoded claims on success, or null on any failure. This is the
 * ONLY thing that may unlock the app - an unsigned "ok" from the server never
 * does. The crypto lives in core (verifyEdDSAJwt) so it can be unit-tested with
 * a generated keypair.
 */
export function verifyLicenseToken(jwt: string): LicenseClaims | null {
	return verifyEdDSAJwt(jwt, LICENSE_PUBLIC_KEYS);
}
