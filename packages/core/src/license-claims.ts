import type { LicenseClaims, LicenseState } from './types.js';

// Pure, browser-safe license evaluation. No crypto and no node imports so it is
// unit-testable in isolation: "is this a valid JWT signature" (token.ts, main
// process) and "are these claims acceptable right now" (here) are deliberately
// separate questions.

/** Parses a JWT payload segment into typed claims, or null if malformed. The
 * signature is NOT checked here — callers must verify it first. */
export function parseLicenseClaims(payloadJson: string): LicenseClaims | null {
	let raw: unknown;
	try {
		raw = JSON.parse(payloadJson);
	} catch {
		return null;
	}
	if (typeof raw !== 'object' || raw === null) return null;
	const c = raw as Record<string, unknown>;
	if (
		typeof c.sub !== 'string' ||
		typeof c.aud !== 'string' ||
		typeof c.iss !== 'string' ||
		typeof c.iat !== 'number' ||
		typeof c.exp !== 'number' ||
		typeof c.lic !== 'string' ||
		typeof c.dev !== 'string' ||
		typeof c.plan !== 'string' ||
		typeof c.sta !== 'string' ||
		typeof c.fp !== 'string'
	) {
		return null;
	}
	if (c.plan !== 'trial' && c.plan !== 'lifetime') {
		return null;
	}
	if (c.sta !== 'active' && c.sta !== 'trialing') return null;
	return {
		sub: c.sub,
		aud: c.aud,
		iss: c.iss,
		iat: c.iat,
		exp: c.exp,
		lic: c.lic,
		dev: c.dev,
		plan: c.plan,
		sta: c.sta,
		fp: c.fp,
		tex: typeof c.tex === 'number' ? c.tex : null,
		since: typeof c.since === 'number' ? c.since : null,
		hn: typeof c.hn === 'string' ? c.hn : null,
		he: typeof c.he === 'string' ? c.he : null,
		hi: typeof c.hi === 'string' ? c.hi : null
	};
}

export const LICENSE_AUDIENCE = 'super-review-desktop';

/**
 * Maps signature-verified claims to a LicenseState, given the current time and
 * this machine's fingerprint hash. This is where "the token is authentic but is
 * it usable on THIS machine, right now" is decided.
 *
 * Returns a `locked` state (never throws) so the caller can render a reason.
 */
export function licenseClaimsToState(
	claims: LicenseClaims,
	nowMs: number,
	fingerprintHash: string
): LicenseState {
	// Audience binding: a token minted for something else never unlocks the app.
	if (claims.aud !== LICENSE_AUDIENCE) {
		return { state: 'locked', reason: 'revoked' };
	}
	// Device binding: the token is only valid on the machine it was issued for.
	if (claims.fp !== fingerprintHash) {
		return { state: 'locked', reason: 'fingerprint_mismatch' };
	}
	// Expiry: the 72h offline budget.
	if (nowMs >= claims.exp * 1000) {
		return { state: 'locked', reason: 'offline_expired' };
	}
	return {
		state: 'licensed',
		plan: claims.plan,
		status: claims.sta,
		trialEndsAt: claims.sta === 'trialing' ? (claims.tex ?? undefined) : undefined,
		activeSince: claims.since ?? undefined,
		holder:
			claims.hn || claims.he || claims.hi
				? {
						name: claims.hn ?? undefined,
						email: claims.he ?? undefined,
						avatarUrl: claims.hi ?? undefined
					}
				: undefined,
		offlineExpiresAt: claims.exp * 1000
	};
}
