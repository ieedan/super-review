import { v } from 'convex/values';
import { components } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { query, internalQuery } from './_generated/server';
import { internalMutation } from './utils';
import { authComponent } from './auth';
import { env } from '../env.convex';
import { convexError, createConvexError } from './errors';

const TRIAL_MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Resolves the GitHub OAuth account id for a better-auth user via the local
 * component's adapter API. This id is the stable anti-trial-farming key. */
export async function getGithubAccountId(
	ctx: QueryCtx | MutationCtx,
	userId: string
): Promise<string | null> {
	const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'account',
		where: [{ field: 'userId', value: userId }],
		paginationOpts: { numItems: 20, cursor: null }
	})) as { page: Array<{ providerId: string; accountId: string }> };
	const github = result.page.find((a) => a.providerId === 'github');
	return github?.accountId ?? null;
}

/** One license per user, created lazily on first read/activation. */
export async function getOrCreateLicense(
	ctx: MutationCtx,
	userId: string
): Promise<Doc<'licenses'>> {
	const existing = await ctx.db
		.query('licenses')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.unique();
	if (existing) return existing;

	const githubAccountId = await getGithubAccountId(ctx, userId);
	if (!githubAccountId) {
		throw createConvexError(convexError.Unauthorized());
	}
	const id = await ctx.db.insert('licenses', {
		userId,
		githubAccountId,
		plan: 'none',
		status: 'inactive'
	});
	return (await ctx.db.get(id))!;
}

/**
 * Starts the 7-day trial at first desktop activation, once per GitHub account
 * forever. The `trials` table is the permanent record; deleting and recreating
 * the web account does not reset it. No-op when the license already has a paid
 * plan or the trial was already consumed.
 */
export async function startTrialIfEligible(
	ctx: MutationCtx,
	license: Doc<'licenses'>
): Promise<Doc<'licenses'>> {
	if (license.plan !== 'none') return license;

	const consumed = await ctx.db
		.query('trials')
		.withIndex('by_githubAccountId', (q) => q.eq('githubAccountId', license.githubAccountId))
		.first();
	if (consumed) {
		// Trial already used by this GitHub account (possibly on a deleted user).
		// Reattach the historical window so the license reflects reality.
		await ctx.db.patch(license._id, {
			plan: 'trial',
			status: consumed.endsAt > Date.now() ? 'trialing' : 'expired',
			trialStartedAt: consumed.startedAt,
			trialEndsAt: consumed.endsAt
		});
		return (await ctx.db.get(license._id))!;
	}

	const now = Date.now();
	const endsAt = now + env.TRIAL_DAYS * TRIAL_MS_PER_DAY;
	await ctx.db.insert('trials', {
		githubAccountId: license.githubAccountId,
		userId: license.userId,
		startedAt: now,
		endsAt
	});
	await ctx.db.patch(license._id, {
		plan: 'trial',
		status: 'trialing',
		trialStartedAt: now,
		trialEndsAt: endsAt
	});
	return (await ctx.db.get(license._id))!;
}

export const getOrCreateForUser = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		return getOrCreateLicense(ctx, args.userId);
	}
});

/**
 * Dashboard: the signed-in user's license (null before first activation).
 *
 * Returns the literal 'unauthenticated' instead of throwing when there is no
 * auth identity, so the live client subscription doesn't error during sign-out
 * or before auth settles. The sentinel (rather than null) lets the dashboard
 * tell "auth is settling, keep showing what we have" apart from "signed in
 * with no license".
 */
export const getMine = query({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) return 'unauthenticated' as const;
		return await ctx.db
			.query('licenses')
			.withIndex('by_userId', (q) => q.eq('userId', user._id))
			.unique();
	}
});

/**
 * Will activating a device right now start a fresh 7-day trial for the signed-in
 * user? True only when they hold no paid plan AND have never consumed a trial on
 * this GitHub account, mirroring startTrialIfEligible exactly. Drives the
 * /activate page's "Start free trial" vs "Authorize device" copy so it never
 * promises a trial the activation would not actually grant (e.g. a paying user
 * adding a second device, or someone whose trial already expired).
 */
export const trialEligibility = query({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) return { eligible: false };
		const license = await ctx.db
			.query('licenses')
			.withIndex('by_userId', (q) => q.eq('userId', user._id))
			.unique();
		// A started trial or any paid plan means no new trial can begin.
		if (license && license.plan !== 'none') return { eligible: false };
		const githubAccountId = license?.githubAccountId ?? (await getGithubAccountId(ctx, user._id));
		if (!githubAccountId) return { eligible: false };
		const consumed = await ctx.db
			.query('trials')
			.withIndex('by_githubAccountId', (q) => q.eq('githubAccountId', githubAccountId))
			.first();
		return { eligible: !consumed };
	}
});

/** Internal: the plan on a user's license, or null if none. Used by the Stripe
 * checkout guard to stop a lifetime holder from starting a paid subscription. */
export const getPlanForUser = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const license = await ctx.db
			.query('licenses')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.unique();
		return license?.plan ?? null;
	}
});

/**
 * Admin preview (Convex dashboard only): how many licenses `resetTrials` would
 * touch, broken down by current status, without changing anything. Run this
 * before the mutation to sanity-check the blast radius.
 */
export const previewResetTrials = internalQuery({
	args: {},
	handler: async (ctx) => {
		const licenses = await ctx.db.query('licenses').collect();
		const summary = { trialing: 0, expired: 0, suspended: 0, willReset: 0 };
		for (const license of licenses) {
			if (license.plan !== 'trial') continue;
			// Leave suspended trials alone: those were auto-suspended for abuse, and
			// re-granting would resurrect a farmed account.
			if (license.status === 'suspended') {
				summary.suspended++;
				continue;
			}
			if (license.status === 'trialing') summary.trialing++;
			else if (license.status === 'expired') summary.expired++;
			summary.willReset++;
		}
		return summary;
	}
});

/**
 * Admin (Convex dashboard only): grant every account that currently holds a
 * trial a fresh TRIAL_DAYS window starting now. Only licenses on the `trial`
 * plan are touched, so paid (`monthly`/`annual`/`lifetime`) and never-activated
 * (`none`) accounts are left untouched, and suspended trials (auto-suspended for
 * abuse) are skipped so a reset does not resurrect a farmed account.
 *
 * The matching `trials` ledger row is moved forward in step with the license.
 * That consistency is the point: the ledger is the permanent per-GitHub-account
 * record, and if it kept the old window, `startTrialIfEligible` would reattach
 * that stale window on the next validation and silently undo the reset.
 *
 * Desktop devices need no action; each picks up the new `trialEndsAt` on its
 * next validation, within the 72h signed-token budget.
 *
 * Guarded by a deployment-scoped confirmation phrase, like `adminReset:wipe`, so
 * the same command cannot be replayed against the wrong deployment. Run
 * `previewResetTrials` first to see how many rows it will touch.
 */
export const resetTrials = internalMutation({
	args: { confirm: v.string() },
	handler: async (ctx, args) => {
		// The phrase embeds the deployment name so a stray `convex run` (or a
		// command copied from another environment) cannot mass-reset the wrong one.
		const deployment = (process.env.CONVEX_CLOUD_URL ?? '')
			.replace(/^https?:\/\//, '')
			.replace(/\.convex\.cloud$/, '');
		const expected = `RESET ALL TRIALS ON ${deployment}`;
		if (args.confirm !== expected) {
			throw new Error(`Refusing to reset. To confirm, pass { "confirm": "${expected}" }`);
		}

		const now = Date.now();
		const endsAt = now + env.TRIAL_DAYS * TRIAL_MS_PER_DAY;

		const licenses = await ctx.db.query('licenses').collect();
		let reset = 0;
		let skippedSuspended = 0;
		for (const license of licenses) {
			if (license.plan !== 'trial') continue;
			if (license.status === 'suspended') {
				skippedSuspended++;
				continue;
			}

			await ctx.db.patch(license._id, {
				status: 'trialing',
				trialStartedAt: now,
				trialEndsAt: endsAt
			});

			const ledger = await ctx.db
				.query('trials')
				.withIndex('by_githubAccountId', (q) => q.eq('githubAccountId', license.githubAccountId))
				.first();
			if (ledger) {
				await ctx.db.patch(ledger._id, { startedAt: now, endsAt });
			} else {
				// A trial-plan license with no ledger row shouldn't exist, but insert
				// one rather than leave a gap the next validation would fill with a
				// stale window.
				await ctx.db.insert('trials', {
					githubAccountId: license.githubAccountId,
					userId: license.userId,
					startedAt: now,
					endsAt
				});
			}
			reset++;
		}

		return { deployment, reset, skippedSuspended, trialEndsAt: endsAt };
	}
});

/** Dashboard: the signed-in user's devices with active token counts.
 * Returns 'unauthenticated' while auth is settling; see getMine. */
export const getMyDevices = query({
	args: {},
	handler: async (ctx) => {
		// See getMine: safe (non-throwing) so the live subscription never errors.
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) return 'unauthenticated' as const;
		const license = await ctx.db
			.query('licenses')
			.withIndex('by_userId', (q) => q.eq('userId', user._id))
			.unique();
		if (!license) return [];
		const devices = await ctx.db
			.query('devices')
			.withIndex('by_licenseId', (q) => q.eq('licenseId', license._id))
			.collect();
		return devices.filter((d) => !d.revokedAt);
	}
});
