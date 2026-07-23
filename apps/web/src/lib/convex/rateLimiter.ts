import { RateLimiter, HOUR, DAY } from '@convex-dev/rate-limiter';
import { components } from './_generated/api';

// Enforced inside Convex functions (not the SvelteKit layer) so the limits
// survive any bypass of the Vercel layer.
export const rateLimiter = new RateLimiter(components.rateLimiter, {
	// Desktop requests a device code: capped per client IP.
	activationStart: { kind: 'fixed window', rate: 15, period: HOUR },
	// Desktop polls for approval every ~3s for up to a 10-min TTL (~200 polls per
	// flow), so the caps are generous: a per-IP ceiling plus a per-device-code
	// backstop against a looping client. The real security is the secret,
	// fingerprint-bound device code, not these limits.
	activationPoll: { kind: 'fixed window', rate: 600, period: HOUR },
	activationPollCode: { kind: 'fixed window', rate: 300, period: HOUR },
	// Signed-in user looking up / approving a code in the browser. The inspect
	// cap slows brute-forcing of the short user code.
	activationInspect: { kind: 'fixed window', rate: 20, period: HOUR },
	activationApprove: { kind: 'fixed window', rate: 10, period: DAY },
	// Waitlist signup, called directly from the public marketing page. The
	// per-address cap stops one email hammering the mutation; the global cap is a
	// ceiling on total growth, so a scripted flood of unique addresses stalls.
	waitlistJoinEmail: { kind: 'fixed window', rate: 5, period: HOUR },
	waitlistJoinGlobal: { kind: 'token bucket', rate: 200, period: HOUR, capacity: 50 },
	// Invite redemption attempts per signed-in user. The codes carry ~38 bits, so
	// this is belt-and-braces rather than the actual defense.
	inviteRedeem: { kind: 'fixed window', rate: 10, period: HOUR },
	// Emailing a guest invite to a friend. Per-user so a member cannot spam Loops
	// (or strangers) by repeatedly mailing their three codes around.
	inviteEmailGuest: { kind: 'fixed window', rate: 10, period: HOUR },
	// In-app feedback. Anonymous submissions mean the IP cap is the only real
	// defense, so it is tight; the global cap is a ceiling on a distributed
	// flood, sized so a genuine burst of reports after a bad release still lands.
	feedbackSubmitIp: { kind: 'fixed window', rate: 10, period: HOUR },
	feedbackSubmitGlobal: { kind: 'token bucket', rate: 300, period: HOUR, capacity: 60 },
	// License validation: per device token and per IP.
	licenseValidateToken: { kind: 'fixed window', rate: 30, period: DAY },
	licenseValidateIp: { kind: 'fixed window', rate: 60, period: HOUR }
});
