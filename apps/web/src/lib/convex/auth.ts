import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { stripe } from '@better-auth/stripe';
import Stripe from 'stripe';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { GenericActionCtx } from 'convex/server';
import { query } from './_generated/server';
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal';
import authConfig from './auth.config';
import authSchema from './betterAuth/schema';
import { env } from '../env.convex';
import { subscriptionWillCancel } from './licensingShared';

const siteUrl = env.SITE_URL;

// Local install: the component schema lives in ./betterAuth/schema.ts so it can
// include plugin tables (the Stripe plugin's subscription model).
export const authComponent = createClient<DataModel, typeof authSchema>(components.betterAuth, {
	local: { schema: authSchema }
});

// The Stripe SDK defaults to Node's http client, which doesn't exist in the
// Convex runtime. Fetch + SubtleCrypto keep it runtime-compatible. The `||`
// placeholder only matters during Convex's env-less push analysis, where the
// key is empty and `new Stripe('')` would otherwise throw; at runtime the real
// key is present. Stripe validates the key on API calls, not at construction.
const stripeClient = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_placeholder_build', {
	httpClient: Stripe.createFetchHttpClient()
});

/** Adds a user to the waitlist, never throwing. See the databaseHooks below. */
async function joinWaitlistQuietly(
	actionCtx: GenericActionCtx<DataModel>,
	userId: string
): Promise<void> {
	try {
		await actionCtx.runMutation(internal.waitlist.joinForUser, { userId });
	} catch (err) {
		console.error('[waitlist] auto-join failed', err);
	}
}

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
	// Billing hooks only ever fire while handling the Stripe webhook, which the
	// component serves from an http action, so runMutation is available there.
	const actionCtx = ctx as GenericActionCtx<DataModel>;

	return {
		baseURL: siteUrl,
		database: authComponent.adapter(ctx),
		socialProviders: {
			github: {
				clientId: env.GITHUB_CLIENT_ID,
				clientSecret: env.GITHUB_CLIENT_SECRET
			}
		},
		databaseHooks: {
			// Signing up (or signing in) joins the waitlist. Hooked at the database
			// layer rather than off a page load, because activating the desktop app
			// authorizes a device without ever passing through the dashboard - so
			// anything hung off the dashboard misses the route most people take, and
			// leaves them with an account and no waitlist row.
			//
			// Both hooks call the same idempotent mutation, which no-ops when waitlist
			// mode is off, when the address is already listed, and for existing
			// members. Failures are swallowed: joining a waitlist must never be the
			// reason someone cannot sign in.
			user: {
				create: {
					// New accounts.
					after: async (user: { id: string }) => {
						await joinWaitlistQuietly(actionCtx, user.id);
					}
				}
			},
			session: {
				create: {
					// Every sign-in. `user.create` alone would only ever cover accounts
					// made after this shipped, leaving every existing account stranded
					// off the list with no way back on except the dashboard button.
					after: async (session: { userId: string }) => {
						await joinWaitlistQuietly(actionCtx, session.userId);
					}
				}
			}
		},
		plugins: [
			// The Convex plugin is required for Convex compatibility
			convex({ authConfig }),
			stripe({
				stripeClient,
				stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
				createCustomerOnSignUp: true,
				onEvent: async (event) => {
					await handleStripeEvent(actionCtx, event);
				},
				subscription: {
					enabled: true,
					plans: [
						{
							name: 'pro',
							priceId: env.STRIPE_PRICE_MONTHLY,
							annualDiscountPriceId: env.STRIPE_PRICE_ANNUAL
							// Deliberately no Stripe `freeTrial`. Every account already gets a
							// single 7-day trial in the app (startTrialIfEligible, keyed on the
							// GitHub account and never reset). A Stripe subscription trial would
							// stack a SECOND free week on top of that, since the plugin's
							// anti-farming check only looks at prior Stripe subscriptions and
							// knows nothing about the app trial. Subscribing therefore charges
							// at checkout; the app trial stays the one and only free window.
						}
					],
					// Subscriptions are always available, including during the launch
					// window (the lifetime deal is an extra option then, not the only
					// one). Only the lifetime purchase itself is launch-window gated,
					// enforced in billing.createLifetimeCheckout.
					getCheckoutSessionParams: async ({ user }) => {
						// Closed beta: do not open Stripe Checkout for accounts that
						// have not redeemed an invite (or already hold a plan).
						const betaAllowed = await actionCtx.runQuery(internal.waitlist.hasAccessForUser, {
							userId: user.id
						});
						if (!betaAllowed) {
							throw new Error('Redeem an invite code before upgrading.');
						}
						// A lifetime license never expires, so charging its owner for a
						// subscription would take money for nothing. Block it server-side
						// (this hook runs before the Stripe Checkout session is created).
						const plan = await actionCtx.runQuery(internal.licenses.getPlanForUser, {
							userId: user.id
						});
						if (plan === 'lifetime') {
							throw new Error(
								'You already own a perpetual license, so there is nothing to subscribe to.'
							);
						}
						// Referral reward: members who got all their guest codes redeemed
						// check out at a discount. Applied server-side rather than via a
						// promo code the user types, so it cannot be shared or guessed.
						//
						// Note `discounts` and `allow_promotion_codes` are mutually
						// exclusive in Stripe Checkout: adding a promo-code box later
						// means choosing one per session, not both.
						const coupon = env.STRIPE_REFERRAL_COUPON_ID;
						if (!coupon) return {};
						const earned = await actionCtx.runQuery(internal.invites.hasReferralReward, {
							userId: user.id
						});
						return earned ? { params: { discounts: [{ coupon }] } } : {};
					},
					onSubscriptionComplete: async ({ subscription, stripeSubscription }) => {
						await syncSubscription(actionCtx, subscription.referenceId, stripeSubscription);
					},
					onSubscriptionUpdate: async ({ subscription, stripeSubscription }) => {
						await syncSubscription(actionCtx, subscription.referenceId, stripeSubscription);
					},
					onSubscriptionDeleted: async ({ subscription, stripeSubscription }) => {
						await syncSubscription(actionCtx, subscription.referenceId, stripeSubscription);
					}
				}
			})
		]
	} satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) => {
	return betterAuth(createAuthOptions(ctx));
};

/** Maps a Stripe subscription onto the user's license row. */
async function syncSubscription(
	ctx: GenericActionCtx<DataModel>,
	userId: string,
	stripeSubscription: Stripe.Subscription
) {
	const item = stripeSubscription.items.data[0];
	const priceId = item?.price.id ?? null;
	const currentPeriodEnd = item?.current_period_end ? item.current_period_end * 1000 : null;
	await ctx.runMutation(internal.billing.syncSubscription, {
		userId,
		stripeCustomerId:
			typeof stripeSubscription.customer === 'string'
				? stripeSubscription.customer
				: stripeSubscription.customer.id,
		stripeSubscriptionId: stripeSubscription.id,
		stripeStatus: stripeSubscription.status,
		priceId,
		currentPeriodEnd,
		cancelAtPeriodEnd: subscriptionWillCancel({
			cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
			cancelAt: stripeSubscription.cancel_at
		})
	});
}

/** Lifetime purchases, refunds, and chargebacks (not covered by the
 * subscription lifecycle hooks). */
async function handleStripeEvent(ctx: GenericActionCtx<DataModel>, event: Stripe.Event) {
	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object;
			if (session.metadata?.kind !== 'lifetime' || session.payment_status !== 'paid') return;
			const userId = session.metadata.userId;
			if (!userId) return;
			await ctx.runMutation(internal.billing.markLifetime, {
				userId,
				stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
				paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null
			});
			return;
		}
		case 'charge.refunded': {
			const charge = event.data.object;
			const customerId = typeof charge.customer === 'string' ? charge.customer : null;
			if (!customerId) return;
			await ctx.runMutation(internal.billing.suspendByCustomer, {
				stripeCustomerId: customerId,
				reason: 'refund'
			});
			return;
		}
		case 'charge.dispute.created': {
			const dispute = event.data.object;
			const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;
			const charge = await stripeClient.charges.retrieve(chargeId);
			const customerId = typeof charge.customer === 'string' ? charge.customer : null;
			if (!customerId) return;
			await ctx.runMutation(internal.billing.suspendByCustomer, {
				stripeCustomerId: customerId,
				reason: 'chargeback'
			});
			return;
		}
	}
}

export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx);
	}
});
