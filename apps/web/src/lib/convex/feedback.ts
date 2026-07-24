import { v } from 'convex/values';
import { secretMutation } from './utils';
import { authComponent } from './auth';
import { internal } from './_generated/api';
import { rateLimiter } from './rateLimiter';
import { convexError, createConvexError } from './errors';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

// Caps mirroring the desktop dialog's own limits, enforced here too so a
// modified client can't store an unbounded blob.
const MAX_TITLE = 200;
const MAX_BODY = 10_000;
const MAX_EMAIL = 320;

const contextValidator = v.object({
	action: v.optional(v.string()),
	tab: v.optional(v.string()),
	repo: v.optional(v.string()),
	branch: v.optional(v.string()),
	location: v.optional(v.string())
});

/**
 * Called by POST /api/feedback (secret-authed). Stores one feedback submission
 * and schedules the notification webhook.
 *
 * Attribution is best-effort: `deviceTokenHash` is supplied when the desktop
 * app had a device token to send, and an unrecognized or revoked one is
 * silently treated as anonymous rather than rejected. A broken license is a
 * reason to accept the report, not to refuse it.
 */
export const submit = secretMutation({
	args: {
		category: v.union(v.literal('bug'), v.literal('idea'), v.literal('other')),
		title: v.string(),
		body: v.string(),
		email: v.optional(v.string()),
		context: v.optional(contextValidator),
		appVersion: v.string(),
		platform: v.string(),
		osRelease: v.string(),
		arch: v.optional(v.string()),
		electronVersion: v.optional(v.string()),
		deviceTokenHash: v.optional(v.string()),
		ipHash: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		if (args.ipHash) {
			const ip = await rateLimiter.limit(ctx, 'feedbackSubmitIp', { key: args.ipHash });
			if (!ip.ok) throw createConvexError(convexError.RateLimited());
		}
		const global = await rateLimiter.limit(ctx, 'feedbackSubmitGlobal');
		if (!global.ok) throw createConvexError(convexError.RateLimited());

		const title = args.title.trim().slice(0, MAX_TITLE);
		const body = args.body.trim().slice(0, MAX_BODY);
		if (!title || !body) throw createConvexError(convexError.InvalidFeedback());

		const reporter = await resolveReporter(ctx, args.deviceTokenHash);

		const id = await ctx.db.insert('feedback', {
			category: args.category,
			title,
			body,
			email: args.email?.trim().slice(0, MAX_EMAIL) || undefined,
			context: args.context,
			appVersion: args.appVersion,
			platform: args.platform,
			osRelease: args.osRelease,
			arch: args.arch,
			electronVersion: args.electronVersion,
			userId: reporter?.userId,
			licenseId: reporter?.licenseId,
			ipHash: args.ipHash,
			createdAt: Date.now()
		});

		// After the write commits, so a webhook outage never loses the feedback.
		await ctx.scheduler.runAfter(0, internal.notify.postFeedback, {
			feedbackId: id,
			category: args.category,
			title,
			body,
			email: args.email?.trim() || undefined,
			context: args.context,
			appVersion: args.appVersion,
			platform: args.platform,
			osRelease: args.osRelease,
			arch: args.arch,
			electronVersion: args.electronVersion,
			reporterName: reporter?.name,
			reporterEmail: reporter?.email,
			reporterImage: reporter?.image,
			plan: reporter?.plan,
			status: reporter?.status
		});

		return { id };
	}
});

interface Reporter {
	userId: string;
	licenseId: Id<'licenses'>;
	plan: string;
	status: string;
	name?: string;
	email?: string;
	image?: string;
}

/**
 * Resolves a device token hash to the license holder, so a report arrives with
 * a name and a plan attached instead of an opaque id. Returns null for anything
 * that doesn't cleanly resolve, which is then reported as anonymous.
 */
async function resolveReporter(
	ctx: MutationCtx,
	deviceTokenHash: string | undefined
): Promise<Reporter | null> {
	if (!deviceTokenHash) return null;
	const token = await ctx.db
		.query('deviceTokens')
		.withIndex('by_tokenHash', (q) => q.eq('tokenHash', deviceTokenHash))
		.unique();
	if (!token || token.revokedAt) return null;

	const license = await ctx.db.get(token.licenseId);
	if (!license) return null;

	// Same lookup the license token uses for its display identity. Best effort:
	// a missing user is not a reason to drop the attribution we do have.
	const user = await authComponent.getAnyUserById(ctx, license.userId).catch(() => null);

	return {
		userId: token.userId,
		licenseId: token.licenseId,
		plan: license.plan,
		status: license.status,
		name: user?.name ?? undefined,
		email: user?.email ?? undefined,
		image: user?.image ?? undefined
	};
}
