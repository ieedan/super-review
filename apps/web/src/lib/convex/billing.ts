import { v } from 'convex/values';
import Stripe from 'stripe';
import { action } from './_generated/server';
import { internalMutation } from './utils';
import { internal } from './_generated/api';
import { authComponent } from './auth';
import { getOrCreateLicense } from './licenses';
import { env } from '../env.convex';
import { isLaunchOpen } from '../pricing';
import { convexError, createConvexError } from './errors';

/**
 * Which Stripe price to charge right now. The launch window swaps the price id
 * rather than applying a coupon on purpose: Stripe Checkout takes at most one
 * entry in `discounts`, and the referral reward already claims it. A separate
 * price leaves that slot free, so a referred buyer gets 15% off the launch
 * price instead of having to choose between the two offers.
 *
 * Falls back to the standing price whenever the launch price is unconfigured,
 * so a missing env var overcharges rather than undercharges.
 */
function priceIdForNow(now: number): string {
	const launchOpen = isLaunchOpen(env.LAUNCH_CUTOFF, now);
	return launchOpen && env.STRIPE_PRICE_LAUNCH
		? env.STRIPE_PRICE_LAUNCH
		: env.STRIPE_PRICE_LIFETIME;
}

export const markLifetime = internalMutation({
	args: {
		userId: v.string(),
		stripeCustomerId: v.union(v.string(), v.null()),
		paymentIntentId: v.union(v.string(), v.null())
	},
	handler: async (ctx, args) => {
		const license = await getOrCreateLicense(ctx, args.userId);
		await ctx.db.patch(license._id, {
			plan: 'lifetime',
			status: license.status === 'suspended' ? 'suspended' : 'active',
			stripeCustomerId: args.stripeCustomerId ?? license.stripeCustomerId,
			lifetimePurchasedAt: Date.now()
		});
	}
});

export const suspendByCustomer = internalMutation({
	args: {
		stripeCustomerId: v.string(),
		reason: v.union(v.literal('refund'), v.literal('chargeback'))
	},
	handler: async (ctx, args) => {
		const license = await ctx.db
			.query('licenses')
			.withIndex('by_stripeCustomerId', (q) => q.eq('stripeCustomerId', args.stripeCustomerId))
			.unique();
		if (!license) return;
		await ctx.db.patch(license._id, {
			status: 'suspended',
			suspendedAt: Date.now(),
			suspensionReason: args.reason
		});
	}
});

/**
 * Mints a Stripe Checkout session for the perpetual purchase - the only thing
 * Super Review sells. It is a plain one-time payment session; the webhook
 * (checkout.session.completed with metadata.kind=lifetime) marks the license.
 *
 * The price is resolved here, server-side, so a stale page holding the launch
 * price cannot buy at it after the window has closed.
 */
export const createLifetimeCheckout = action({
	args: {},
	handler: async (ctx): Promise<{ url: string }> => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) throw createConvexError(convexError.Unauthorized());
		const betaAllowed = await ctx.runQuery(internal.waitlist.hasAccessForUser, {
			userId: user._id
		});
		if (!betaAllowed) {
			throw createConvexError(convexError.WaitlistRequired());
		}
		const license = await ctx.runMutation(internal.licenses.getOrCreateForUser, {
			userId: user._id
		});
		if (license.plan === 'lifetime') {
			throw createConvexError(convexError.AlreadyLifetime());
		}

		const stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
			httpClient: Stripe.createFetchHttpClient()
		});
		const customerId = license.stripeCustomerId ?? user.stripeCustomerId ?? undefined;

		// Referral reward, applied server-side off the account's earned state
		// rather than a code they type.
		const coupon = env.STRIPE_REFERRAL_COUPON_ID;
		const earned =
			!!coupon && (await ctx.runQuery(internal.invites.hasReferralReward, { userId: user._id }));

		const session = await stripeClient.checkout.sessions.create({
			mode: 'payment',
			customer: customerId,
			customer_email: customerId ? undefined : user.email,
			line_items: [{ price: priceIdForNow(Date.now()), quantity: 1 }],
			// `discounts` and `allow_promotion_codes` are mutually exclusive in
			// Stripe Checkout, so the earned referral reward wins and everyone
			// else gets the promo-code box.
			...(earned ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
			metadata: { kind: 'lifetime', userId: user._id },
			success_url: `${env.SITE_URL}/dashboard?checkout=success`,
			// /pricing rather than the homepage anchor, which is hidden in waitlist
			// mode. Also fixes the query living inside the fragment
			// (`/#pricing?checkout=canceled`), where `checkout` was never a real
			// search param.
			cancel_url: `${env.SITE_URL}/pricing?checkout=canceled`
		});
		if (!session.url) throw new Error('Stripe did not return a checkout URL');
		return { url: session.url };
	}
});
