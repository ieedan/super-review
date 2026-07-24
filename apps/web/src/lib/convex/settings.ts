import { v } from 'convex/values';
import { query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation } from './utils';
import { WAITLIST_MODE_DEFAULT } from './settingsShared';

// The single settings row. One document, looked up by a literal key, so reads
// stay a point lookup and there is never a second row to disagree with.
const SETTINGS_KEY = 'app' as const;

const DEFAULTS = {
	waitlistMode: WAITLIST_MODE_DEFAULT
};

async function readSettings(ctx: QueryCtx | MutationCtx) {
	return await ctx.db
		.query('settings')
		.withIndex('by_key', (q) => q.eq('key', SETTINGS_KEY))
		.unique();
}

/**
 * Public runtime flags for the marketing site. Safe to expose: it carries no
 * user data. Returns the defaults when the row does not exist yet, so a fresh
 * deployment renders the pre-launch site rather than erroring.
 */
export const getPublic = query({
	args: {},
	handler: async (ctx) => {
		const row = await readSettings(ctx);
		return { waitlistMode: row?.waitlistMode ?? DEFAULTS.waitlistMode };
	}
});

/**
 * Flips waitlist mode. Internal, so it is not callable from the browser, but
 * still runnable from the Convex dashboard's function runner:
 *
 *   Functions -> settings:setWaitlistMode -> Run with { "enabled": true }
 *
 * Upserts, so it works on a deployment that has never had a settings row. The
 * marketing pages subscribe to `getPublic`, so open tabs switch over live and
 * no redeploy is involved.
 */
export const setWaitlistMode = internalMutation({
	args: { enabled: v.boolean() },
	handler: async (ctx, args) => {
		const row = await readSettings(ctx);
		if (row) {
			await ctx.db.patch(row._id, { waitlistMode: args.enabled, updatedAt: Date.now() });
		} else {
			await ctx.db.insert('settings', {
				key: SETTINGS_KEY,
				waitlistMode: args.enabled,
				updatedAt: Date.now()
			});
		}
		return { waitlistMode: args.enabled };
	}
});
