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
			// Super Review sells exactly one thing: the perpetual license, a one-time
			// payment minted by billing.createLifetimeCheckout. The plugin's
			// `subscription` support is deliberately left off - the plugin is here for
			// `createCustomerOnSignUp` and for serving the Stripe webhook, whose events
			// handleStripeEvent turns into license changes.
			stripe({
				stripeClient,
				stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
				createCustomerOnSignUp: true,
				onEvent: async (event) => {
					await handleStripeEvent(actionCtx, event);
				}
			})
		]
	} satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) => {
	return betterAuth(createAuthOptions(ctx));
};

/** The perpetual purchase, refunds, and chargebacks: every Stripe event that
 * moves a license. */
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
