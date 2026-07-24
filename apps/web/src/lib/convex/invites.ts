import { v } from 'convex/values';
import { query, internalQuery } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { mutation, internalMutation } from './utils';
import { internal } from './_generated/api';
import { authComponent } from './auth';
import { getGithubAccountId } from './licenses';
import { isValidEmail, normalizeEmail, waitlistModeOn } from './waitlist';
import { rateLimiter } from './rateLimiter';
import { convexError, createConvexError } from './errors';

// Confusable characters are omitted (no O/0, I/1/L, U/V) because people retype
// these off a phone screen. 29 symbols over 8 characters is ~39 bits, which with
// the redeem rate limit makes guessing hopeless while staying short enough to
// read aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const GROUP = 4;
const GROUPS = 2;

/** How many guest codes a beta redeemer gets to hand out. */
export const GUEST_CODES_PER_MEMBER = 3;

/**
 * Percentage off checkout for a member whose guest codes were all redeemed.
 *
 * Display only: the real discount is the Stripe coupon named by
 * STRIPE_REFERRAL_COUPON_ID, so this constant and that coupon must agree. Stripe
 * is the source of truth for what is actually charged.
 */
export const REFERRAL_DISCOUNT_PERCENT = 15;

function generateCode(): string {
	const bytes = new Uint8Array(GROUP * GROUPS);
	crypto.getRandomValues(bytes);
	const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
	const groups: string[] = [];
	for (let i = 0; i < GROUPS; i++) {
		groups.push(chars.slice(i * GROUP, (i + 1) * GROUP).join(''));
	}
	return `SUPER-${groups.join('-')}`;
}

/** Normalizes user input: case and stray spacing shouldn't matter. */
export function normalizeCode(raw: string): string {
	const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
	return cleaned.startsWith('SUPER-') ? cleaned : `SUPER-${cleaned}`;
}

/**
 * Inserts a code, retrying on the astronomically unlikely collision rather than
 * silently issuing a duplicate that would break single-use redemption.
 */
async function insertUniqueCode(
	ctx: MutationCtx,
	fields: {
		kind: 'beta' | 'guest';
		issuedToEmail?: string;
		issuedByUserId?: string;
	}
): Promise<string> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = generateCode();
		const clash = await ctx.db
			.query('inviteCodes')
			.withIndex('by_code', (q) => q.eq('code', code))
			.unique();
		if (clash) continue;
		await ctx.db.insert('inviteCodes', { ...fields, code, createdAt: Date.now() });
		return code;
	}
	throw new Error('Could not generate a unique invite code');
}

/**
 * Mints a beta code for a waitlist address and emails it. Internal: this is the
 * "accept someone into the beta" action, run from the Convex dashboard.
 *
 * Idempotent per address: if an unredeemed beta code already exists for this
 * email it is resent rather than a second one minted, so re-running the sweep
 * cannot leave one person holding two live codes.
 */
export const inviteEmail = internalMutation({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		const email = normalizeEmail(args.email);

		const existing = await ctx.db
			.query('inviteCodes')
			.withIndex('by_issuedToEmail', (q) => q.eq('issuedToEmail', email))
			.collect();
		// Guest codes can also record issuedToEmail once a member emails one to a
		// friend; only beta codes count here so that path cannot steal the
		// "already invited" slot from a later waitlist sweep.
		const live = existing.find((c) => c.kind === 'beta' && !c.redeemedAt && !c.revokedAt);

		const code = live
			? live.code
			: await insertUniqueCode(ctx, { kind: 'beta', issuedToEmail: email });

		// Mark the waitlist row so the pending list skips them next sweep. The row
		// may not exist when inviting someone who never joined, which is fine.
		const signup = await ctx.db
			.query('waitlistSignups')
			.withIndex('by_email', (q) => q.eq('email', email))
			.unique();
		if (signup && signup.invitedAt === undefined) {
			await ctx.db.patch(signup._id, { invitedAt: Date.now() });
		}

		await ctx.scheduler.runAfter(0, internal.email.sendInviteEmail, { email, code });
		return { email, code, resent: !!live };
	}
});

/**
 * Invites the next N people in signup order. The bulk version of `inviteEmail`,
 * for opening the beta a wave at a time.
 */
export const inviteNext = internalMutation({
	args: { count: v.number() },
	handler: async (ctx, args): Promise<{ invited: Array<{ email: string; code: string }> }> => {
		const rows = await ctx.db
			.query('waitlistSignups')
			.withIndex('by_invitedAt_createdAt', (q) => q.eq('invitedAt', undefined))
			.order('asc')
			.take(Math.max(0, Math.min(args.count, 200)));

		const invited: Array<{ email: string; code: string }> = [];
		for (const row of rows) {
			const code = await insertUniqueCode(ctx, { kind: 'beta', issuedToEmail: row.email });
			await ctx.db.patch(row._id, { invitedAt: Date.now() });
			await ctx.scheduler.runAfter(0, internal.email.sendInviteEmail, {
				email: row.email,
				code
			});
			invited.push({ email: row.email, code });
		}
		return { invited };
	}
});

/**
 * Emails one of the caller's unused guest codes to a friend.
 *
 * The code stays owned by the member and still appears on their dashboard; this
 * only delivers it. `issuedToEmail` is recorded so we know who it was sent to,
 * and re-running for the same code updates that address and resends (useful when
 * a typo bounced, or they want to pass it to someone else before it is used).
 *
 * Uses the guest-invite Loops template (names the sender) rather than the
 * beta-wave one, which has no inviter.
 */
export const emailGuestCode = mutation({
	args: { code: v.string(), email: v.string() },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw createConvexError(convexError.Unauthorized());

		if (!(await waitlistModeOn(ctx))) {
			throw createConvexError(convexError.InviteCodesClosed());
		}

		const email = normalizeEmail(args.email);
		if (!isValidEmail(email)) {
			throw createConvexError(convexError.InvalidEmail());
		}

		const attempts = await rateLimiter.limit(ctx, 'inviteEmailGuest', { key: user._id });
		if (!attempts.ok) throw createConvexError(convexError.RateLimited());

		const code = normalizeCode(args.code);
		const invite = await ctx.db
			.query('inviteCodes')
			.withIndex('by_code', (q) => q.eq('code', code))
			.unique();

		// Same opaque error for "not yours", "already used", "revoked", and
		// "not a guest code": this is a member-facing action, not an oracle.
		if (
			!invite ||
			invite.kind !== 'guest' ||
			invite.issuedByUserId !== user._id ||
			invite.revokedAt ||
			invite.redeemedAt
		) {
			throw createConvexError(convexError.InvalidInviteCode());
		}

		// Prefer the GitHub display name; fall back to the email local-part so the
		// template always has something human to put in "{name} sent you...".
		const inviterName =
			(typeof user.name === 'string' && user.name.trim()) || user.email.split('@')[0] || 'A friend';

		await ctx.db.patch(invite._id, { issuedToEmail: email });
		await ctx.scheduler.runAfter(0, internal.email.sendGuestInviteEmail, {
			email,
			code: invite.code,
			inviterName
		});

		return { ok: true as const, email, code: invite.code };
	}
});

/**
 * Grants the referral discount once every guest code a member was given has been
 * redeemed. Called after a redemption, for the account that issued that code.
 *
 * Idempotent: the reward is only written when it is not already set, so a member
 * cannot earn it twice (which matters because it never expires).
 *
 * Deliberately counts *their own issued codes* rather than a fixed number, so it
 * stays correct if GUEST_CODES_PER_MEMBER ever changes or a code is revoked.
 * Revoked codes are excluded from the denominator, so revoking an unused one
 * does not permanently block the reward.
 */
async function awardReferralRewardIfComplete(ctx: MutationCtx, issuerUserId: string) {
	const member = await ctx.db
		.query('betaMembers')
		.withIndex('by_userId', (q) => q.eq('userId', issuerUserId))
		.unique();
	if (!member || member.referralRewardEarnedAt) return;

	const issued = await ctx.db
		.query('inviteCodes')
		.withIndex('by_issuedByUserId', (q) => q.eq('issuedByUserId', issuerUserId))
		.collect();
	const live = issued.filter((c) => !c.revokedAt);
	if (live.length === 0 || live.some((c) => !c.redeemedAt)) return;

	await ctx.db.patch(member._id, { referralRewardEarnedAt: Date.now() });
	await ctx.scheduler.runAfter(0, internal.email.sendReferralRewardEmail, {
		email: member.email,
		percentOff: REFERRAL_DISCOUNT_PERCENT
	});
}

/**
 * Redeems an invite code for the signed-in account. This is how someone becomes
 * a beta member.
 *
 * Rate limited per user: the codes are high-entropy, but a cheap cap turns
 * "hopeless" into "not even worth attempting". Redemption is single-use and
 * binds to the GitHub account id, so a shared code lets exactly one person in.
 */
export const redeem = mutation({
	args: { code: v.string() },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw createConvexError(convexError.Unauthorized());

		// Invites only exist to gate the closed beta. With waitlist mode off the app
		// is open to everyone, so a code grants nothing - and closing redemption is
		// what makes the referral reward self-terminating at launch rather than
		// needing an expiry date of its own.
		if (!(await waitlistModeOn(ctx))) {
			throw createConvexError(convexError.InviteCodesClosed());
		}

		const attempts = await rateLimiter.limit(ctx, 'inviteRedeem', { key: user._id });
		if (!attempts.ok) throw createConvexError(convexError.RateLimited());

		const githubAccountId = await getGithubAccountId(ctx, user._id);
		if (!githubAccountId) throw createConvexError(convexError.Unauthorized());

		// Already in: treat as success so a double submit or a stale tab doesn't
		// look like a failure, and don't burn the code they just typed.
		const already = await ctx.db
			.query('betaMembers')
			.withIndex('by_githubAccountId', (q) => q.eq('githubAccountId', githubAccountId))
			.unique();
		if (already) return { ok: true as const, alreadyMember: true as const };

		const code = normalizeCode(args.code);
		const invite = await ctx.db
			.query('inviteCodes')
			.withIndex('by_code', (q) => q.eq('code', code))
			.unique();

		// One error for every failure mode on purpose: distinguishing "no such
		// code" from "already used" would let someone map the code space.
		if (!invite || invite.revokedAt || invite.redeemedAt) {
			throw createConvexError(convexError.InvalidInviteCode());
		}

		await ctx.db.patch(invite._id, {
			redeemedByUserId: user._id,
			redeemedByGithubAccountId: githubAccountId,
			redeemedAt: Date.now()
		});

		await ctx.db.insert('betaMembers', {
			githubAccountId,
			userId: user._id,
			email: user.email,
			joinedAt: Date.now(),
			viaCode: invite.code,
			viaCodeKind: invite.kind
		});

		// Guest codes go only to people who came in on a beta code. Minting them
		// for guest redeemers too would make growth compound (3^n per generation)
		// with no ceiling and no way to slow it down once it started.
		let guestCodes: string[] = [];
		if (invite.kind === 'beta') {
			guestCodes = [];
			for (let i = 0; i < GUEST_CODES_PER_MEMBER; i++) {
				guestCodes.push(await insertUniqueCode(ctx, { kind: 'guest', issuedByUserId: user._id }));
			}
		}

		// No email on redemption. The invite email is the welcome, and redeeming
		// lands the reader on the dashboard, so anything sent here would describe a
		// page they are already looking at. Guest codes are surfaced there too,
		// never by email.

		// This redemption may have been the one that used up the inviter's last
		// guest code, which earns them the referral discount.
		if (invite.issuedByUserId) {
			await awardReferralRewardIfComplete(ctx, invite.issuedByUserId);
		}

		return { ok: true as const, alreadyMember: false as const, guestCodes };
	}
});

/**
 * The caller's membership and their guest codes, for the dashboard.
 *
 * Soft-auth, matching licenses.getMine: returns the 'unauthenticated' sentinel
 * rather than throwing, so the brief windows where the socket has no token
 * don't flash the wrong state.
 */
export const getMine = query({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) return 'unauthenticated' as const;

		const member = await ctx.db
			.query('betaMembers')
			.withIndex('by_userId', (q) => q.eq('userId', user._id))
			.unique();

		const owned = await ctx.db
			.query('inviteCodes')
			.withIndex('by_issuedByUserId', (q) => q.eq('issuedByUserId', user._id))
			.collect();

		// Whether there is genuinely a waitlist row for this account's email. The
		// dashboard used to claim "you're on the waitlist" unconditionally, which
		// was false for anyone who signed in without ever joining. Reported so the
		// copy can only make the claim when it is actually true.
		const signup = await ctx.db
			.query('waitlistSignups')
			.withIndex('by_email', (q) => q.eq('email', user.email.trim().toLowerCase()))
			.unique();

		return {
			waitlistMode: await waitlistModeOn(ctx),
			isMember: !!member,
			onWaitlist: !!signup,
			waitlistJoinedAt: signup?.createdAt ?? null,
			joinedAt: member?.joinedAt ?? null,
			guestCodes: owned
				.filter((c) => !c.revokedAt)
				.map((c) => ({
					code: c.code,
					redeemed: !!c.redeemedAt,
					// Who the member last emailed this code to, if anyone. Null until
					// they use the "email a friend" flow; the dashboard shows it as a
					// quiet confirmation rather than as something they must act on.
					sentTo: c.issuedToEmail ?? null
				})),
			// The referral reward: earned once every guest code has been redeemed.
			// `percentOff` travels with it so the dashboard and the checkout button
			// cannot disagree about the number being advertised.
			referralReward: {
				earnedAt: member?.referralRewardEarnedAt ?? null,
				percentOff: REFERRAL_DISCOUNT_PERCENT
			}
		};
	}
});

/**
 * Whether this account has earned the referral discount. Internal, and read
 * from the checkout paths (which run in action contexts) to decide whether to
 * attach the Stripe coupon.
 */
export const hasReferralReward = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const member = await ctx.db
			.query('betaMembers')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.unique();
		return !!member?.referralRewardEarnedAt;
	}
});

/** Revokes an unredeemed code. Redeemed ones are left alone: pulling one would
 * not remove the member it already created. */
export const revokeCode = internalMutation({
	args: { code: v.string() },
	handler: async (ctx, args) => {
		const invite = await ctx.db
			.query('inviteCodes')
			.withIndex('by_code', (q) => q.eq('code', normalizeCode(args.code)))
			.unique();
		if (!invite) return { found: false as const };
		if (invite.redeemedAt) return { found: true as const, revoked: false as const };
		await ctx.db.patch(invite._id, { revokedAt: Date.now() });
		return { found: true as const, revoked: true as const };
	}
});

/** Removes someone from the beta. The invite rows stay, so the audit trail of
 * who invited whom survives. */
export const removeMember = internalMutation({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		const email = normalizeEmail(args.email);
		const members = await ctx.db.query('betaMembers').collect();
		const member = members.find((m) => m.email.toLowerCase() === email);
		if (!member) return { removed: false as const };
		await ctx.db.delete(member._id);
		return { removed: true as const };
	}
});
