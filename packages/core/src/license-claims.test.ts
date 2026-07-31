import { describe, it, expect } from 'vitest';
import { parseLicenseClaims, licenseClaimsToState, LICENSE_AUDIENCE } from './license-claims.js';
import type { LicenseClaims } from './types.js';

const FP = 'abc123fingerprinthash';
const NOW = 1_800_000_000_000; // ms

function claims(overrides: Partial<LicenseClaims> = {}): LicenseClaims {
	return {
		sub: 'user_1',
		aud: LICENSE_AUDIENCE,
		iss: 'https://superreview.dev',
		iat: NOW / 1000 - 60,
		exp: NOW / 1000 + 72 * 3600,
		lic: 'lic_1',
		dev: 'dev_1',
		plan: 'lifetime',
		sta: 'active',
		fp: FP,
		tex: null,
		...overrides
	};
}

describe('parseLicenseClaims', () => {
	it('parses a well-formed payload', () => {
		const parsed = parseLicenseClaims(JSON.stringify(claims()));
		expect(parsed?.plan).toBe('lifetime');
	});

	it('rejects malformed JSON and missing fields', () => {
		expect(parseLicenseClaims('not json')).toBeNull();
		expect(parseLicenseClaims(JSON.stringify({ sub: 'x' }))).toBeNull();
	});

	it('rejects invalid plan/status enums', () => {
		expect(parseLicenseClaims(JSON.stringify(claims({ plan: 'gold' as never })))).toBeNull();
		expect(parseLicenseClaims(JSON.stringify(claims({ sta: 'expired' as never })))).toBeNull();
	});
});

describe('licenseClaimsToState', () => {
	it('unlocks a valid, unexpired, fingerprint-matching token', () => {
		const state = licenseClaimsToState(claims(), NOW, FP);
		expect(state).toMatchObject({ state: 'licensed', plan: 'lifetime', status: 'active' });
	});

	it('locks on audience mismatch', () => {
		const state = licenseClaimsToState(claims({ aud: 'someone-else' }), NOW, FP);
		expect(state).toEqual({ state: 'locked', reason: 'revoked' });
	});

	it('locks on fingerprint mismatch (token copied to another machine)', () => {
		const state = licenseClaimsToState(claims(), NOW, 'different-machine');
		expect(state).toEqual({ state: 'locked', reason: 'fingerprint_mismatch' });
	});

	it('locks when the offline budget (exp) has passed', () => {
		const expired = claims({ exp: NOW / 1000 - 1 });
		expect(licenseClaimsToState(expired, NOW, FP)).toEqual({
			state: 'locked',
			reason: 'offline_expired'
		});
	});

	it('surfaces trialEndsAt while trialing', () => {
		const trial = claims({ plan: 'trial', sta: 'trialing', tex: NOW + 86_400_000 });
		const state = licenseClaimsToState(trial, NOW, FP);
		expect(state).toMatchObject({
			state: 'licensed',
			status: 'trialing',
			trialEndsAt: NOW + 86_400_000
		});
	});
});
