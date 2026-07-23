// TEMPORARY dev utility - delete after use.
// Inspects and clears the deployment's data so the beta flow can be tested from
// scratch. Never run this against production.
import { v } from 'convex/values';
import { internalQuery } from './_generated/server';
import { internalMutation } from './utils';
import { components } from './_generated/api';

const APP_TABLES = [
	'licenses',
	'trials',
	'devices',
	'activationCodes',
	'deviceTokens',
	'validationEvents',
	'abuseFlags',
	'waitlistSignups',
	'inviteCodes',
	'betaMembers'
] as const;

// Order matters: dependent records first, users last.
const AUTH_MODELS = ['session', 'account', 'verification', 'subscription', 'user'] as const;

/**
 * Dev-only: set the (single) license's trial to end `days` from now so the
 * desktop trial countdown can be exercised. Patches the license row and the
 * matching `trials` record so both stay consistent. Refuses if there isn't
 * exactly one license, so it can't silently touch the wrong row. Never for prod.
 */
export const setTrialDaysLeft = internalMutation({
	args: { days: v.number() },
	handler: async (ctx, args) => {
		const DAY = 24 * 60 * 60 * 1000;
		const now = Date.now();
		const endsAt = now + args.days * DAY;
		const startedAt = endsAt - 7 * DAY;

		const licenses = await ctx.db.query('licenses').collect();
		if (licenses.length !== 1) {
			throw new Error(`Expected exactly 1 license, found ${licenses.length}. Refusing to guess.`);
		}
		const license = licenses[0];
		const before = {
			plan: license.plan,
			status: license.status,
			trialEndsAt: license.trialEndsAt ?? null
		};

		await ctx.db.patch(license._id, {
			plan: 'trial',
			status: 'trialing',
			trialStartedAt: startedAt,
			trialEndsAt: endsAt
		});

		const trial = await ctx.db
			.query('trials')
			.withIndex('by_githubAccountId', (q) => q.eq('githubAccountId', license.githubAccountId))
			.first();
		if (trial) await ctx.db.patch(trial._id, { startedAt, endsAt });

		return { before, after: { plan: 'trial', status: 'trialing', trialEndsAt: endsAt }, days: args.days };
	}
});

export const inspect = internalQuery({
	args: {},
	handler: async (ctx) => {
		const app: Record<string, number> = {};
		for (const table of APP_TABLES) {
			app[table] = (await ctx.db.query(table).collect()).length;
		}
		const auth: Record<string, number> = {};
		for (const model of AUTH_MODELS) {
			const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model,
				paginationOpts: { numItems: 500, cursor: null }
			})) as { page: unknown[] };
			auth[model] = res.page.length;
		}
		const settings = await ctx.db.query('settings').collect();
		return {
			app,
			auth,
			settingsRows: settings.length,
			waitlistMode: settings[0]?.waitlistMode ?? null
		};
	}
});

/**
 * Exercises the adapter lookup that was warning about a missing index, so the
 * fix can be confirmed from the logs rather than assumed.
 */
export const probeSubscriptionIndex = internalQuery({
	args: {},
	handler: async (ctx) => {
		const found = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'subscription',
			where: [{ field: 'stripeSubscriptionId', value: 'sub_probe_nonexistent' }]
		});
		return { found: found ?? null };
	}
});

/**
 * Deletes every row of test data. Requires the literal confirmation phrase so a
 * stray `convex run` cannot wipe a deployment.
 *
 * `settings` is preserved: it holds waitlistMode, which is configuration rather
 * than test data, and silently flipping the site out of waitlist mode would be a
 * surprising side effect of "clear the test data".
 */
export const wipe = internalMutation({
	args: { confirm: v.string() },
	handler: async (ctx, args) => {
		// The confirmation phrase embeds the deployment name, so the same command
		// cannot be replayed against a different deployment. Without this,
		// `convex run --prod adminReset:wipe` would silently destroy production.
		const deployment = (process.env.CONVEX_CLOUD_URL ?? '')
			.replace(/^https?:\/\//, '')
			.replace(/\.convex\.cloud$/, '');
		const expected = `DELETE ALL DATA ON ${deployment}`;
		if (args.confirm !== expected) {
			throw new Error(`Refusing to wipe. To confirm, pass { "confirm": "${expected}" }`);
		}

		const deletedApp: Record<string, number> = {};
		for (const table of APP_TABLES) {
			const rows = await ctx.db.query(table).collect();
			for (const row of rows) await ctx.db.delete(row._id);
			deletedApp[table] = rows.length;
		}

		const deletedAuth: Record<string, number> = {};
		for (const model of AUTH_MODELS) {
			let deleted = 0;
			// deleteMany works a page at a time, so loop until the model reads back
			// empty rather than assuming one call clears it. The bound is a
			// runaway guard, not an expected limit.
			for (let pass = 0; pass < 20; pass++) {
				const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
					model,
					paginationOpts: { numItems: 500, cursor: null }
				})) as { page: unknown[] };
				if (res.page.length === 0) break;
				// `paginationOpts` is a sibling of `input`, not part of it. `model` is
				// a per-call literal union a loop variable can't satisfy, hence the cast.
				await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
					input: { model },
					paginationOpts: { numItems: 500, cursor: null }
				} as never);
				deleted += res.page.length;
			}
			deletedAuth[model] = deleted;
		}

		return { deletedApp, deletedAuth, preserved: ['settings'] };
	}
});
