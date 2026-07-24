// Pure license evaluation logic, shared by the validate endpoint and the
// dashboard. No Convex imports so it stays unit-testable.

export type LicenseDenialReason =
	| 'trial_expired'
	| 'subscription_lapsed'
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
	plan: 'none' | 'trial' | 'monthly' | 'annual' | 'lifetime';
	status: 'inactive' | 'trialing' | 'active' | 'expired' | 'suspended';
	trialEndsAt?: number;
	currentPeriodEnd?: number;
}

/** Small grace on subscription renewal so a card retry does not lock paying
 * users out the minute a period ends. */
export const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** Stripe schedules a "cancel at end of period" two different ways: the
 * `cancel_at_period_end` boolean, or a `cancel_at` timestamp (what the billing
 * portal actually sets). Either one means the subscription will not renew, so
 * the dashboard should read "Cancels" rather than "Renews". */
export function subscriptionWillCancel(fields: {
	cancelAtPeriodEnd?: boolean | null;
	cancelAt?: number | null;
}): boolean {
	return !!fields.cancelAtPeriodEnd || fields.cancelAt != null;
}

export interface ActiveSinceLicense {
	plan: EvaluatableLicense['plan'];
	lifetimePurchasedAt?: number;
	subscribedAt?: number;
	/** Falls back to the license row's creation time for subscriptions predating
	 * the `subscribedAt` field. */
	createdAt?: number;
}

/**
 * When the paid plan started, for the "Active since" line on the license card.
 * Null for trials and unlicensed - only paid plans have a start date worth
 * showing. Mirrors what the web dashboard passes to LicenseCard.
 */
export function activeSinceFor(license: ActiveSinceLicense): number | null {
	if (license.plan === 'lifetime') return license.lifetimePurchasedAt ?? null;
	if (license.plan === 'monthly' || license.plan === 'annual') {
		return license.subscribedAt ?? license.createdAt ?? null;
	}
	return null;
}

export function evaluateLicense(license: EvaluatableLicense, now: number): LicenseDecision {
	if (license.status === 'suspended') {
		return { allowed: false, reason: 'suspended' };
	}
	switch (license.plan) {
		case 'lifetime':
			return { allowed: true, status: 'active', expiresAt: null };
		case 'monthly':
		case 'annual': {
			const periodEnd = license.currentPeriodEnd ?? 0;
			if (now < periodEnd + SUBSCRIPTION_GRACE_MS) {
				return { allowed: true, status: 'active', expiresAt: periodEnd };
			}
			return { allowed: false, reason: 'subscription_lapsed' };
		}
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
