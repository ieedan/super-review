// Pure license evaluation logic, shared by the validate endpoint and the
// dashboard. No Convex imports so it stays unit-testable.

export type LicenseDenialReason =
	| 'trial_expired'
	| 'suspended'
	| 'no_license'
	| 'device_revoked'
	| 'invalid_token'
	// Beta gate: the account is on the waitlist but not accepted yet. Only ever
	// produced while waitlist mode is on, and never for an account that already
	// holds a plan.
	| 'waitlist';

export type LicenseDecision =
	| { allowed: true; status: 'active' | 'trialing'; expiresAt: number | null }
	| { allowed: false; reason: LicenseDenialReason };

export interface EvaluatableLicense {
	plan: 'none' | 'trial' | 'lifetime';
	status: 'inactive' | 'trialing' | 'active' | 'expired' | 'suspended';
	trialEndsAt?: number;
}

export interface ActiveSinceLicense {
	plan: EvaluatableLicense['plan'];
	lifetimePurchasedAt?: number;
}

/**
 * When the paid plan started, for the "Active since" line on the license card.
 * Null for trials and unlicensed - only the perpetual license has a start date
 * worth showing. Mirrors what the web dashboard passes to LicenseCard.
 */
export function activeSinceFor(license: ActiveSinceLicense): number | null {
	if (license.plan === 'lifetime') return license.lifetimePurchasedAt ?? null;
	return null;
}

export function evaluateLicense(license: EvaluatableLicense, now: number): LicenseDecision {
	if (license.status === 'suspended') {
		return { allowed: false, reason: 'suspended' };
	}
	switch (license.plan) {
		case 'lifetime':
			return { allowed: true, status: 'active', expiresAt: null };
		case 'trial': {
			const trialEnd = license.trialEndsAt ?? 0;
			if (now < trialEnd) {
				return { allowed: true, status: 'trialing', expiresAt: trialEnd };
			}
			return { allowed: false, reason: 'trial_expired' };
		}
		case 'none':
			return { allowed: false, reason: 'no_license' };
	}
}
