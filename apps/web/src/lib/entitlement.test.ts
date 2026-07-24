import { describe, expect, it } from 'vitest';
import { isWaitlistBlocked, isWaitlistPending, waitlistModeFrom } from './entitlement';
import { WAITLIST_MODE_DEFAULT } from './convex/settingsShared';

// The point of these: the unknown cases. A regression here doesn't throw or fail
// a typecheck, it quietly opens the beta on a deployment nobody configured.

describe('WAITLIST_MODE_DEFAULT', () => {
	it('is closed, so an unconfigured deployment is invite-only', () => {
		expect(WAITLIST_MODE_DEFAULT).toBe(true);
	});
});

describe('waitlistModeFrom', () => {
	it('uses the flag when the settings query answered', () => {
		expect(waitlistModeFrom({ data: { waitlistMode: false } })).toBe(false);
		expect(waitlistModeFrom({ data: { waitlistMode: true } })).toBe(true);
	});

	it('falls back to closed when it did not', () => {
		expect(waitlistModeFrom(undefined)).toBe(true);
		expect(waitlistModeFrom(null)).toBe(true);
		expect(waitlistModeFrom({})).toBe(true);
		expect(waitlistModeFrom({ data: null })).toBe(true);
	});
});

describe('isWaitlistBlocked', () => {
	it('agrees with isWaitlistPending whenever the answer is known', () => {
		const cases = [
			{ waitlistMode: false, isMember: false },
			{ waitlistMode: false, isMember: true },
			{ waitlistMode: true, isMember: false },
			{ waitlistMode: true, isMember: true }
		];
		for (const invites of cases) {
			expect(isWaitlistBlocked(invites)).toBe(isWaitlistPending(invites));
		}
	});

	it('blocks a member only while waitlist mode is on and they are not in', () => {
		expect(isWaitlistBlocked({ waitlistMode: true, isMember: false })).toBe(true);
		expect(isWaitlistBlocked({ waitlistMode: true, isMember: true })).toBe(false);
		expect(isWaitlistBlocked({ waitlistMode: false, isMember: false })).toBe(false);
	});

	it('blocks when the invites query could not answer', () => {
		expect(isWaitlistBlocked(null)).toBe(true);
		expect(isWaitlistBlocked(undefined)).toBe(true);
		expect(isWaitlistBlocked('unauthenticated')).toBe(true);
	});

	it('leaves isWaitlistPending open in the same cases, since it gates nothing', () => {
		expect(isWaitlistPending(null)).toBe(false);
		expect(isWaitlistPending(undefined)).toBe(false);
		expect(isWaitlistPending('unauthenticated')).toBe(false);
	});
});
