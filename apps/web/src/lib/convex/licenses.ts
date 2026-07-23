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
