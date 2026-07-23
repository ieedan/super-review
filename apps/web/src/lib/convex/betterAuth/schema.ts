/**
 * Better Auth component schema, plus our custom indexes.
 *
 * The generated table definitions live in ./generatedSchema.ts (regenerate with
 * `npx auth generate --output generatedSchema.ts` from this directory). Custom
 * indexes are added here instead of there, so regenerating never drops them.
 * See https://labs.convex.dev/better-auth/features/local-install#adding-custom-indexes
 */
import { defineSchema } from 'convex/server';
import { tables } from './generatedSchema';

export { tables };

const schema = defineSchema({
	...tables,
	// The Stripe plugin looks subscriptions up by Stripe id on every webhook.
	// Without this the adapter falls back to a full table scan and Convex warns
	// about the document read limit.
	subscription: tables.subscription.index('stripeSubscriptionId', ['stripeSubscriptionId'])
});

export default schema;
