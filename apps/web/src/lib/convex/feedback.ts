import { v } from 'convex/values';
import { secretMutation, internalMutation } from './utils';
import { internalQuery } from './_generated/server';
import { authComponent } from './auth';
import { internal } from './_generated/api';
import { rateLimiter } from './rateLimiter';
import { convexError, createConvexError } from './errors';
import type { QueryCtx } from './_generated/server';
import type { FeedbackReport } from './notifyShared';
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
		// Only the id travels: the notification reads the row back, so a retry
		// hours later needs nothing kept alive in the scheduler.
		await ctx.scheduler.runAfter(0, internal.notify.postFeedback, { feedbackId: id });

		return { id };
	}
});

/**
 * The report as the Discord notification needs it, with the reporter resolved
 * to a name and a plan rather than an opaque id.
 *
 * Read at send time rather than captured at submit time so a retry only has to
 * carry the row id. That does mean a report delivered late shows the license as
 * it is now, which is the more useful of the two answers when you are reading
 * the thread.
 */
export const loadForNotify = internalQuery({
	args: { feedbackId: v.id('feedback') },
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.feedbackId);
		if (!row) return null;

		const reporter = await resolveReporterIdentity(ctx, row.licenseId);

		const report: FeedbackReport & {
			discordMessageId?: string;
			discordThreadId?: string;
			notifiedAt?: number;
		} = {
			feedbackId: row._id,
			category: row.category,
			title: row.title,
			body: row.body,
			email: row.email,
			context: row.context,
			appVersion: row.appVersion,
			platform: row.platform,
			osRelease: row.osRelease,
			arch: row.arch,
			electronVersion: row.electronVersion,
			reporterName: reporter?.name,
			reporterEmail: reporter?.email,
			reporterImage: reporter?.image,
			plan: reporter?.plan,
			status: reporter?.status,
			discordMessageId: row.discordMessageId,
			discordThreadId: row.discordThreadId,
			notifiedAt: row.notifiedAt
		};
		return report;
	}
});

/**
 * Records what Discord did with a report. Called from notify.postFeedback,
 * which cannot write to the database itself.
 *
 * Partial by design: the message id lands as soon as the report is posted, well
 * before the thread exists, because that is what makes a retry open the missing
 * thread instead of posting the report a second time.
 */
export const recordDelivery = internalMutation({
	args: {
		feedbackId: v.id('feedback'),
		discordMessageId: v.optional(v.string()),
		discordThreadId: v.optional(v.string()),
		delivered: v.optional(v.boolean()),
		error: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.feedbackId);
		if (!row) return;

		const patch: {
			discordMessageId?: string;
			discordThreadId?: string;
			notifiedAt?: number;
			notifyAttempts?: number;
			notifyError?: string;
		} = {};
		if (args.discordMessageId) patch.discordMessageId = args.discordMessageId;
		if (args.discordThreadId) patch.discordThreadId = args.discordThreadId;
		if (args.delivered) patch.notifiedAt = Date.now();
		if (args.error) {
			patch.notifyError = args.error;
			patch.notifyAttempts = (row.notifyAttempts ?? 0) + 1;
		} else if (args.delivered) {
			// Cleared so a row that succeeded on its third attempt doesn't keep
			// showing the failure from its second.
			patch.notifyError = undefined;
		}
		await ctx.db.patch(args.feedbackId, patch);
	}
});

interface Reporter {
	userId: string;
	licenseId: Id<'licenses'>;
}

/**
 * Resolves a device token hash to the license it belongs to, so a report is
 * attributed instead of anonymous. Returns null for anything that doesn't
 * cleanly resolve, which is then stored as anonymous.
 */
async function resolveReporter(
	ctx: QueryCtx,
	deviceTokenHash: string | undefined
): Promise<Reporter | null> {
	if (!deviceTokenHash) return null;
	const token = await ctx.db
		.query('deviceTokens')
		.withIndex('by_tokenHash', (q) => q.eq('tokenHash', deviceTokenHash))
		.unique();
	if (!token || token.revokedAt) return null;
	if (!(await ctx.db.get(token.licenseId))) return null;

	return { userId: token.userId, licenseId: token.licenseId };
}

/**
 * The display identity behind an attributed report: who they are and what they
 * are paying for. Best effort throughout, since a missing user is not a reason
 * to drop the attribution we do have.
 */
async function resolveReporterIdentity(ctx: QueryCtx, licenseId: Id<'licenses'> | undefined) {
	if (!licenseId) return null;
	const license = await ctx.db.get(licenseId);
	if (!license) return null;

	// Same lookup the license token uses for its display identity.
	const user = await authComponent.getAnyUserById(ctx, license.userId).catch(() => null);

	return {
		plan: license.plan,
		status: license.status,
		name: user?.name ?? undefined,
		email: user?.email ?? undefined,
		image: user?.image ?? undefined
	};
}
