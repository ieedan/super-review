import { v } from 'convex/values';
import { query, internalQuery } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, internalMutation } from './utils';
import { internal } from './_generated/api';
import { authComponent } from './auth';
import { rateLimiter } from './rateLimiter';
import { convexError, createConvexError } from './errors';
import { WAITLIST_MODE_DEFAULT } from './settingsShared';

/**
 * Deliberately loose: this is a signup form, not an identity check. It rejects
 * obvious junk and leaves real deliverability to Loops. The client validates
 * with the same rule so the field can complain before a round trip.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
	return email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);
}

/**
 * Whether beta access is currently restricted. Reads the same settings row the
 * marketing site uses, so every gate switches off together the moment waitlist
 * mode is turned off. Written once because if two gates disagreed, flipping the
 * flag would half-open the app - which is also why the no-row fallback is the
 * shared `WAITLIST_MODE_DEFAULT` rather than a second literal here.
 */
export async function waitlistModeOn(ctx: QueryCtx | MutationCtx): Promise<boolean> {
	const row = await ctx.db
		.query('settings')
		.withIndex('by_key', (q) => q.eq('key', 'app'))
		.unique();
	return row?.waitlistMode ?? WAITLIST_MODE_DEFAULT;
}

/**
 * The access decision for one user, and the single place that decides it.
 *
 * Two deliberate escape hatches, both there so turning waitlist mode on can
 * never strand someone who is legitimately using the app:
 *  - waitlist mode off  -> everyone is allowed, and the invite system is inert.
 *  - already has a plan -> a paying, lifetime, or mid-trial license is never
 *    revoked by the gate. Access is only ever withheld from accounts that have
 *    nothing yet.
 */
export async function hasBetaAccess(ctx: QueryCtx | MutationCtx, userId: string): Promise<boolean> {
	if (!(await waitlistModeOn(ctx))) return true;

	const license = await ctx.db
		.query('licenses')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.unique();
	if (license && license.plan !== 'none') return true;

	const member = await ctx.db
		.query('betaMembers')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.unique();
	return !!member;
}

/** Internal: `hasBetaAccess` for action contexts (Stripe checkout guards). */
export const hasAccessForUser = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => hasBetaAccess(ctx, args.userId)
});

/**
 * Adds an address to the waitlist, once. Shared by the public form and by
 * signing in, so the two entry points cannot drift on dedupe, the Loops sync, or
 * the confirmation email.
 *
 * Returns whether a row was actually created; already being on the list is a
 * success, not an error.
 */
async function addToWaitlist(
	ctx: MutationCtx,
	rawEmail: string,
	opts: { rateLimit: boolean; confirmByEmail: boolean }
): Promise<{ ok: true; created: boolean }> {
	const email = normalizeEmail(rawEmail);
	if (!isValidEmail(email)) {
		throw createConvexError(convexError.InvalidEmail());
	}

	const existing = await ctx.db
		.query('waitlistSignups')
		.withIndex('by_email', (q) => q.eq('email', email))
		.unique();
	if (existing) return { ok: true, created: false };

	// Only the unauthenticated form needs limiting. A signed-in join is already
	// bounded by having an account, and rate limiting it could leave someone
	// signed in but not on the list, which is the exact lie we are fixing.
	if (opts.rateLimit) {
		const perEmail = await rateLimiter.limit(ctx, 'waitlistJoinEmail', { key: email });
		if (!perEmail.ok) throw createConvexError(convexError.RateLimited());
		const global = await rateLimiter.limit(ctx, 'waitlistJoinGlobal');
		if (!global.ok) throw createConvexError(convexError.RateLimited());
	}

	await ctx.db.insert('waitlistSignups', { email, createdAt: Date.now() });

	// Mirror into the Loops audience so the list is broadcastable from there.
	// Scheduled rather than awaited: a Loops outage must not fail the signup, and
	// mutations cannot call fetch anyway.
	await ctx.scheduler.runAfter(0, internal.email.syncWaitlistContact, { email });

	// The confirmation only makes sense when joining was the act itself, i.e. the
	// public form. Joining as a side effect of signing in should stay silent: the
	// dashboard already states their status, and someone who signs in and is
	// invited shortly after would otherwise get "we'll email you when a spot opens
	// up" immediately followed by "you're in", which reads as broken.
	//
	// Only reached for a genuinely new address, so resubmitting the form cannot be
	// used to mailbomb someone.
	if (opts.confirmByEmail) {
		await ctx.scheduler.runAfter(0, internal.email.sendWaitlistConfirmation, { email });
	}

	return { ok: true, created: true };
}

/**
 * Joins the waitlist. Public and unauthenticated by design: an email address is
 * the whole cost of entry, and it grants nothing until an invite is redeemed.
 *
 * Rate limited per address and globally, since it is callable straight from the
 * browser. Signing up twice is a silent success, so the response cannot be used
 * to probe whether an address is already on the list.
 */
export const join = mutation({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		await addToWaitlist(ctx, args.email, { rateLimit: true, confirmByEmail: true });
		return { ok: true as const };
	}
});

/**
 * Puts a specific account on the waitlist. Internal, and called from the
 * better-auth `user.create.after` hook, so signing up joins the waitlist no
 * matter which route got them there.
 *
 * That hook is the only place that catches every path: activating the desktop
 * app authorizes a device without ever visiting the dashboard, so anything
 * hung off a page load misses the flow most people actually take.
 *
 * No-op when waitlist mode is off - there is no waitlist to join after launch.
 */
export const joinForUser = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		if (!(await waitlistModeOn(ctx))) {
			return { onWaitlist: false as const, reason: 'not_in_waitlist_mode' as const };
		}
		// Members are past the waitlist, not on it.
		const member = await ctx.db
			.query('betaMembers')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.unique();
		if (member) return { onWaitlist: false as const, reason: 'already_member' as const };

		// Looked up rather than passed in, so both hooks can share one signature:
		// the session hook only knows a userId.
		const user = await authComponent.getAnyUserById(ctx, args.userId);
		if (!user?.email) return { onWaitlist: false as const, reason: 'no_email' as const };

		const res = await addToWaitlist(ctx, user.email, { rateLimit: false, confirmByEmail: false });
		return { onWaitlist: true as const, created: res.created };
	}
});

/**
 * Puts the signed-in user on the waitlist, using their account email.
 *
 * Sign-in is deliberately open (existing customers have to be able to reach
 * their dashboard), which used to mean someone could sign in, be told "you're on
 * the waitlist", and have no row anywhere. Signing in now genuinely joins.
 *
 * No-ops when waitlist mode is off (there is no waitlist to join after launch)
 * and for existing members (they are past the waitlist, not on it).
 */
export const joinAsCurrentUser = mutation({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) return { onWaitlist: false as const, reason: 'unauthenticated' as const };
		if (!(await waitlistModeOn(ctx))) {
			return { onWaitlist: false as const, reason: 'not_in_waitlist_mode' as const };
		}

		const member = await ctx.db
			.query('betaMembers')
			.withIndex('by_userId', (q) => q.eq('userId', user._id))
			.unique();
		if (member) return { onWaitlist: false as const, reason: 'already_member' as const };

		const res = await addToWaitlist(ctx, user.email, { rateLimit: false, confirmByEmail: false });
		return { onWaitlist: true as const, created: res.created };
	}
});

/** Signup count, for a "N people waiting" line if the hero ever wants one. */
export const count = query({
	args: {},
	handler: async (ctx) => (await ctx.db.query('waitlistSignups').collect()).length
});

/**
 * Everyone not yet invited, oldest first, so invites go out in signup order.
 * Internal: run it from the Convex dashboard to see who is up next.
 */
export const pending = internalMutation({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query('waitlistSignups')
			.withIndex('by_invitedAt_createdAt', (q) => q.eq('invitedAt', undefined))
			.order('asc')
			.take(args.limit ?? 100);
		return rows.map((r) => ({ email: r.email, createdAt: r.createdAt }));
	}
});

/** Totals: how many signed up, how many have been sent an invite. */
export const stats = query({
	args: {},
	handler: async (ctx) => {
		const all = await ctx.db.query('waitlistSignups').collect();
		const members = await ctx.db.query('betaMembers').collect();
		return {
			signups: all.length,
			invited: all.filter((r) => r.invitedAt !== undefined).length,
			members: members.length
		};
	}
});

/** Removes an address. Internal; run it when someone asks to be taken off. */
export const removeByEmail = internalMutation({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query('waitlistSignups')
			.withIndex('by_email', (q) => q.eq('email', normalizeEmail(args.email)))
			.unique();
		if (!row) return { removed: false as const };
		await ctx.db.delete(row._id);
		return { removed: true as const };
	}
});
