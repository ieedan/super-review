import { describe, it, expect } from 'vitest';
import { evaluateLicense, type EvaluatableLicense } from './licensingShared';

const NOW = 1_800_000_000_000;

describe('evaluateLicense', () => {
	it('lifetime is always active regardless of dates', () => {
		const lic: EvaluatableLicense = { plan: 'lifetime', status: 'active' };
		expect(evaluateLicense(lic, NOW)).toEqual({ allowed: true, status: 'active', expiresAt: null });
	});

	it('suspended beats every plan', () => {
		const lic: EvaluatableLicense = { plan: 'lifetime', status: 'suspended' };
		expect(evaluateLicense(lic, NOW)).toEqual({ allowed: false, reason: 'suspended' });
	});

	it('trial is allowed before it ends, denied after', () => {
		const active: EvaluatableLicense = {
			plan: 'trial',
			status: 'trialing',
			trialEndsAt: NOW + 1000
		};
		expect(evaluateLicense(active, NOW)).toEqual({
			allowed: true,
			status: 'trialing',
			expiresAt: NOW + 1000
		});
		const expired: EvaluatableLicense = { plan: 'trial', status: 'trialing', trialEndsAt: NOW - 1 };
		expect(evaluateLicense(expired, NOW)).toEqual({ allowed: false, reason: 'trial_expired' });
	});

	it('plan "none" has no license', () => {
		const lic: EvaluatableLicense = { plan: 'none', status: 'inactive' };
		expect(evaluateLicense(lic, NOW)).toEqual({ allowed: false, reason: 'no_license' });
	});
});
