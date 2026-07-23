import { v } from 'convex/values';
import Stripe from 'stripe';
import { action, internalAction, internalQuery } from './_generated/server';
import { internalMutation } from './utils';
import { internal } from './_generated/api';
import { authComponent } from './auth';
import { getOrCreateLicense } from './licenses';
import { subscriptionWillCancel } from './licensingShared';
import { env } from '../env.convex';
import { convexError, createConvexError } from './errors';

/** Stripe subscription statuses that keep a license active. Everything else
 * (canceled, unpaid, incomplete_expired, ...) expires it at period end via
 * the grace window in licensingShared. */
const ACTIVE_STRIPE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export const syncSubscription = internalMutation({
	args: {
		userId: v.string(),
		stripeCustomerId: v.string(),
		stripeSubscriptionId: v.string(),
		stripeStatus: v.string(),
		priceId: v.union(v.string(), v.null()),
		currentPeriodEnd: v.union(v.number(), v.null()),
		cancelAtPeriodEnd: v.boolean()
	},
	handler: async (ctx, args) => {
		const license = await getOrCreateLicense(ctx, args.userId);
		// A lifetime license is never downgraded by subscription churn.
		if (license.plan === 'lifetime') return;

		const plan = args.priceId === env.STRIPE_PRICE_ANNUAL ? 'annual' : 'monthly';
		const active = ACTIVE_STRIPE_STATUSES.has(args.stripeStatus);
		// Suspensions (refund/chargeback) are only lifted manually.
		const status = license.status === 'suspended' ? 'suspended' : active ? 'active' : 'expired';
		await ctx.db.patch(license._id, {
			plan,
			status,
			stripeCustomerId: args.stripeCustomerId,
			stripeSubscriptionId: args.stripeSubscriptionId,
			currentPeriodEnd: args.currentPeriodEnd ?? undefined,
			cancelAtPeriodEnd: args.cancelAtPeriodEnd,
			subscribedAt: license.subscribedAt ?? (active ? Date.now() : undefined)
		});
	}
});

/** Lists every license that has a live Stripe subscription, for backfills. */
export const listSubscriptionLicenses = internalQuery({
	args: {},
	handler: async (ctx) => {
		const licenses = await ctx.db.query('licenses').collect();
		return licenses
			.filter((l) => !!l.stripeSubscriptionId)
			.map((l) => ({ userId: l.userId, stripeSubscriptionId: l.stripeSubscriptionId! }));
	}
});

/**
 * One-off backfill: re-pulls each subscription's current state from Stripe and
 * re-runs syncSubscription, so rows written before a field was persisted (e.g.
 * `cancelAtPeriodEnd`) get corrected without waiting for the next webhook.
 * Run with `npx convex run billing:resyncSubscriptions`.
 */
export const resyncSubscriptions = internalAction({
	args: {},
	handler: async (ctx): Promise<{ resynced: number }> => {
		const stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
			httpClient: Stripe.createFetchHttpClient()
		});
		const rows = await ctx.runQuery(internal.billing.listSubscriptionLicenses, {});
		let resynced = 0;
		for (const { userId, stripeSubscriptionId } of rows) {
			const sub = await stripeClient.subscriptions.retrieve(stripeSubscriptionId);
			const item = sub.items.data[0];
			await ctx.runMutation(internal.billing.syncSubscription, {
				userId,
				stripeCustomerId:
					typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
				stripeSubscriptionId: sub.id,
				stripeStatus: sub.status,
				priceId: item?.price.id ?? null,
				currentPeriodEnd: item?.current_period_end ? item.current_period_end * 1000 : null,
				cancelAtPeriodEnd: subscriptionWillCancel({
					cancelAtPeriodEnd: sub.cancel_at_period_end,
					cancelAt: sub.cancel_at
				})
			});
			resynced += 1;
		}
		return { resynced };
	}
});

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

export const isLaunchWindowOpen = () => Date.now() < Date.parse(env.LAUNCH_CUTOFF);

/**
 * Mints a Stripe Checkout session for the $100 lifetime purchase. The
 * better-auth Stripe plugin is subscription-only, so this is a plain one-time
 * payment session; the webhook (checkout.session.completed with
 * metadata.kind=lifetime) marks the license.
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
		if (!isLaunchWindowOpen()) {
			throw createConvexError(convexError.LaunchWindowClosed());
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

		// Referral reward, same rule as the subscription checkout: applied
		// server-side off the account's earned state rather than a code they type.
		const coupon = env.STRIPE_REFERRAL_COUPON_ID;
		const earned =
			!!coupon && (await ctx.runQuery(internal.invites.hasReferralReward, { userId: user._id }));

		const session = await stripeClient.checkout.sessions.create({
			mode: 'payment',
			customer: customerId,
			customer_email: customerId ? undefined : user.email,
			line_items: [{ price: env.STRIPE_PRICE_LIFETIME, quantity: 1 }],
			...(earned ? { discounts: [{ coupon }] } : {}),
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
