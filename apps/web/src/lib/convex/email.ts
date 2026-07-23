import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { env } from '../env.convex';

// Loops (https://loops.so). Base URL and auth per its API reference; both calls
// below are the documented v1 endpoints.
const LOOPS_API = 'https://app.loops.so/api/v1';

/**
 * Every Loops call is best-effort by design. These run as scheduled actions
 * after the database write has already committed, so throwing would achieve
 * nothing except a retry storm: the signup or the invite is already real, and
 * the code is recoverable from the dashboard. Failures are logged loudly and
 * swallowed.
 *
 * With no API key configured (local dev, or before you set it up) they no-op
 * and say so, rather than pretending to have sent something.
 */
async function loops(
	path: string,
	init: { method: string; body: unknown },
	context: string
): Promise<boolean> {
	const key = env.LOOPS_API_KEY;
	if (!key) {
		console.warn(`[loops] no LOOPS_API_KEY; skipped ${context}`);
		return false;
	}
	try {
		const res = await fetch(`${LOOPS_API}${path}`, {
			method: init.method,
			headers: {
				authorization: `Bearer ${key}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(init.body)
		});
		if (!res.ok) {
			console.error(`[loops] ${context} failed: ${res.status} ${await res.text()}`);
			return false;
		}
		return true;
	} catch (err) {
		console.error(`[loops] ${context} threw`, err);
		return false;
	}
}

/**
 * Sends one transactional email.
 *
 * The template id is an env var and the copy lives in Loops, so wording, sender,
 * and design change without a deploy; this side only supplies data variables.
 * An unset id is a supported state, not an error: it means "this email isn't
 * configured yet", so we log what would have been sent and move on.
 *
 * `context` is what shows up in the log line, and `recoverable` is the detail a
 * failed send would otherwise lose (an invite code, say), so nothing important
 * only ever existed inside an email that never arrived.
 */
async function sendTransactional(opts: {
	transactionalId: string;
	envVarName: string;
	email: string;
	dataVariables: Record<string, string | number>;
	context: string;
	recoverable?: string;
}): Promise<void> {
	const detail = opts.recoverable ? ` (${opts.recoverable})` : '';
	if (!opts.transactionalId) {
		console.warn(`[loops] no ${opts.envVarName}; ${opts.context} not emailed${detail}`);
		return;
	}
	const sent = await loops(
		'/transactional',
		{
			method: 'POST',
			body: {
				transactionalId: opts.transactionalId,
				email: opts.email,
				// Puts them in the audience too, so anyone we email is reachable by
				// broadcast later even if they never come back.
				addToAudience: true,
				dataVariables: opts.dataVariables
			}
		},
		opts.context
	);
	if (!sent) {
		console.error(`[loops] ${opts.context} NOT delivered${detail}`);
	}
}

/**
 * Mirrors a waitlist signup into the Loops audience so the list is broadcastable
 * from there ("we're launching") without exporting anything by hand.
 *
 * Uses update-or-create rather than create: it is idempotent, where create
 * returns 409 for an address already in the audience.
 */
export const syncWaitlistContact = internalAction({
	args: { email: v.string() },
	handler: async (_ctx, args) => {
		await loops(
			'/contacts/update',
			{
				method: 'PUT',
				body: { email: args.email, source: 'waitlist', userGroup: 'waitlist' }
			},
			`sync contact ${args.email}`
		);
	}
});

/**
 * Confirms a waitlist signup ("you're on the list"). Fires only on a genuinely
 * new signup: waitlist.join returns early for an address already on the list, so
 * signing up repeatedly cannot be used to send someone mail.
 *
 * Template variables (referenced in LMX as `{data.x}`): `{data.waitlistUrl}`.
 */
export const sendWaitlistConfirmation = internalAction({
	args: { email: v.string() },
	handler: async (_ctx, args) => {
		await sendTransactional({
			transactionalId: env.LOOPS_WAITLIST_TRANSACTIONAL_ID,
			envVarName: 'LOOPS_WAITLIST_TRANSACTIONAL_ID',
			email: args.email,
			dataVariables: { waitlistUrl: env.SITE_URL },
			context: `waitlist confirmation to ${args.email}`
		});
	}
});

/**
 * Emails someone their invite code.
 *
 * The code is logged alongside any failure because it is the one thing here
 * that is hard to recover from a bounce: it is already minted, so a silent
 * failure would leave a live code nobody has. Resending is
 * `invites:inviteEmail` for the same address, which reuses the existing code.
 *
 * Template variables (referenced in LMX as `{data.x}`): `{data.code}`,
 * `{data.redeemUrl}` (points at /join, which redeems and forwards).
 */
export const sendInviteEmail = internalAction({
	args: { email: v.string(), code: v.string() },
	handler: async (_ctx, args) => {
		await sendTransactional({
			transactionalId: env.LOOPS_INVITE_TRANSACTIONAL_ID,
			envVarName: 'LOOPS_INVITE_TRANSACTIONAL_ID',
			email: args.email,
			dataVariables: {
				code: args.code,
				// /join redeems server-side and forwards to the dashboard, so the
				// button is one click with no form to fill in. The code is still shown
				// in the body for anyone whose client mangles the link, and the
				// dashboard keeps a manual entry field for that case.
				redeemUrl: `${env.SITE_URL}/join?code=${encodeURIComponent(args.code)}`
			},
			context: `invite email to ${args.email}`,
			recoverable: `code ${args.code}`
		});
	}
});

/**
 * Emails a friend's address with one of a member's guest codes.
 *
 * Separate template from `sendInviteEmail` because LMX has no conditionals: this
 * one names the inviter, the beta-wave one does not. Same redeem URL shape, same
 * recovery logging for the code.
 *
 * Template variables (referenced in LMX as `{data.x}`): `{data.code}`,
 * `{data.redeemUrl}`, `{data.inviterName}`.
 */
export const sendGuestInviteEmail = internalAction({
	args: { email: v.string(), code: v.string(), inviterName: v.string() },
	handler: async (_ctx, args) => {
		await sendTransactional({
			transactionalId: env.LOOPS_GUEST_INVITE_TRANSACTIONAL_ID,
			envVarName: 'LOOPS_GUEST_INVITE_TRANSACTIONAL_ID',
			email: args.email,
			dataVariables: {
				code: args.code,
				inviterName: args.inviterName,
				redeemUrl: `${env.SITE_URL}/join?code=${encodeURIComponent(args.code)}`
			},
			context: `guest invite email to ${args.email}`,
			recoverable: `code ${args.code}`
		});
	}
});

/**
 * Tells a member they have earned the referral discount, which happens the
 * moment the last of their guest codes is redeemed.
 *
 * Sent once: the award is only written when it is not already set, so this
 * cannot fire twice for one account.
 *
 * Template variables (referenced in LMX as `{data.x}`): `{data.percentOff}`,
 * `{data.pricingUrl}`.
 */
export const sendReferralRewardEmail = internalAction({
	args: { email: v.string(), percentOff: v.number() },
	handler: async (_ctx, args) => {
		await sendTransactional({
			transactionalId: env.LOOPS_REFERRAL_REWARD_TRANSACTIONAL_ID,
			envVarName: 'LOOPS_REFERRAL_REWARD_TRANSACTIONAL_ID',
			email: args.email,
			dataVariables: {
				percentOff: args.percentOff,
				pricingUrl: `${env.SITE_URL}/pricing`
			},
			context: `referral reward email to ${args.email}`,
			// The reward is already recorded against the account, so a failed send
			// costs the announcement, not the discount itself.
			recoverable: `${args.percentOff}% reward already granted`
		});
	}
});

