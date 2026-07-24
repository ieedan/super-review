import { v } from 'convex/values';
import { query } from './_generated/server';
import { secretMutation } from './utils';
import { authComponent } from './auth';
import { evaluateLicense, activeSinceFor } from './licensingShared';
import { hasBetaAccess } from './waitlist';
import { startTrialIfEligible } from './licenses';
import { rateLimiter } from './rateLimiter';
import { convexError, createConvexError } from './errors';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

// Abuse thresholds (see AGENTS/plan). Flagging is review-first; auto-suspend
// only at the extreme.
const DEVICE_SPRAY_FLAG = 10;
const DEVICE_SPRAY_SUSPEND = 25;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Called by POST /api/license/validate (secret-authed). Looks up the device
 * token by hash, checks fingerprint binding, records the validation, runs the
 * inline abuse check, and returns the license decision + claims for SvelteKit
 * to sign. Never itself returns an "unlock" signal - only signed tokens do.
 */
export const validateDevice = secretMutation({
	args: {
		tokenHash: v.string(),
		fingerprint: v.string(),
		platform: v.string(),
		appVersion: v.string(),
		ipHash: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		if (args.ipHash) {
			const ip = await rateLimiter.limit(ctx, 'licenseValidateIp', { key: args.ipHash });
			if (!ip.ok) throw createConvexError(convexError.RateLimited());
		}
		const perToken = await rateLimiter.limit(ctx, 'licenseValidateToken', { key: args.tokenHash });
		if (!perToken.ok) throw createConvexError(convexError.RateLimited());

		const token = await ctx.db
			.query('deviceTokens')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
			.unique();
		if (!token || token.revokedAt) {
			return denial('invalid_token');
		}

		const device = await ctx.db.get(token.deviceId);
		if (!device || device.revokedAt) {
			return denial('device_revoked');
		}
		if (device.fingerprint !== args.fingerprint) {
			return denial('fingerprint_mismatch');
		}

		let license = await ctx.db.get(token.licenseId);
		if (!license) {
			return denial('no_license');
		}

		// Beta gate, mirroring activation.poll. An account blocked at activation
		// still holds a valid device token, so accepting it into the beta has to
		// take effect here: start the trial it was refused earlier and let this
		// validation unlock the app, rather than making the user activate again.
		if (!(await hasBetaAccess(ctx, license.userId))) {
			return denial('waitlist');
		}
		if (license.plan === 'none') {
			license = await startTrialIfEligible(ctx, license);
		}

		const now = Date.now();
		await ctx.db.patch(device._id, {
			lastSeenAt: now,
			appVersion: args.appVersion,
			platform: args.platform,
			lastIpHash: args.ipHash ?? device.lastIpHash,
			validationCount: device.validationCount + 1
		});
		await ctx.db.patch(token._id, { lastUsedAt: now });
		await ctx.db.insert('validationEvents', {
			licenseId: license._id,
			deviceId: device._id,
			ipHash: args.ipHash,
			appVersion: args.appVersion,
			at: now
		});

		const suspended = await runInlineAbuseCheck(ctx, license, now);
		const effective: Doc<'licenses'> = suspended ? { ...license, status: 'suspended' } : license;

		const decision = evaluateLicense(
			{
				plan: effective.plan,
				status: effective.status,
				trialEndsAt: effective.trialEndsAt,
				currentPeriodEnd: effective.currentPeriodEnd
			},
			now
		);

		if (!decision.allowed) {
			return denial(decision.reason);
		}
		// Display identity of the license holder, so the desktop shows the real
		// account rather than guessing from whatever GitHub account is signed in
		// locally (those are separate sign-ins and often differ).
		const holderUser = await authComponent.getAnyUserById(ctx, license.userId);
		return {
			ok: true as const,
			holder: holderUser
				? {
						name: holderUser.name ?? null,
						email: holderUser.email ?? null,
						image: holderUser.image ?? null
					}
				: null,
			userId: license.userId,
			licenseId: license._id,
			deviceId: device._id,
			plan: effective.plan,
			status: decision.status,
			trialEndsAt: effective.trialEndsAt ?? null,
			currentPeriodEnd: effective.currentPeriodEnd ?? null,
			activeSince: activeSinceFor({
				plan: effective.plan,
				lifetimePurchasedAt: effective.lifetimePurchasedAt,
				subscribedAt: effective.subscribedAt,
				createdAt: effective._creationTime
			})
		};
	}
});

export const revokeDeviceToken = secretMutation({
	args: { tokenHash: v.string() },
	handler: async (ctx, args) => {
		const token = await ctx.db
			.query('deviceTokens')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
			.unique();
		if (token && !token.revokedAt) {
			await ctx.db.patch(token._id, { revokedAt: Date.now() });
		}
		return { ok: true as const };
	}
});

function denial(reason: string) {
	return { ok: false as const, reason };
}

/**
 * Realtime change signal for a single device, so the desktop can subscribe over
 * Convex's websocket and revalidate the instant its license changes (a purchase,
 * refund, plan change, suspension, or device revocation) instead of waiting for
 * the periodic poll.
 *
 * This is a NUDGE channel only: it returns an opaque string that changes when
 * something license-relevant changes, never an unlock decision. The desktop
 * reacts by calling /api/license/validate, which is still the only path that can
 * produce a signed token. Authenticated by the device token hash (the same
 * credential /api/license/validate uses), so a caller can only watch its own
 * device.
 *
 * The signal deliberately excludes the churny per-validation fields the validate
 * mutation writes (device.lastSeenAt, token.lastUsedAt, validationCount). Those
 * still cause Convex to recompute this query, but the returned value is
 * unchanged, so no push reaches the client - which keeps the desktop's own
 * revalidation from looping back into another revalidation.
 */
export const watchToken = query({
	args: { tokenHash: v.string() },
	handler: async (ctx, args) => {
		const token = await ctx.db
			.query('deviceTokens')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
			.unique();
		if (!token || token.revokedAt) return 'revoked';

		const device = await ctx.db.get(token.deviceId);
		if (!device || device.revokedAt) return 'revoked';

		const license = await ctx.db.get(token.licenseId);
		if (!license) return 'no_license';

		// Every field that can flip the license decision, joined into one opaque
		// value. Any change re-pushes; unrelated writes leave it identical.
		return [
			license.plan,
			license.status,
			license.trialEndsAt ?? 0,
			license.currentPeriodEnd ?? 0,
			license.suspendedAt ?? 0
		].join(':');
	}
});

/** Counts distinct fingerprints first-seen in the last 7 days; flags/suspends
 * on spray. Returns true if the license was auto-suspended. */
async function runInlineAbuseCheck(
	ctx: MutationCtx,
	license: Doc<'licenses'>,
	now: number
): Promise<boolean> {
	if (license.status === 'suspended') return true;
	const devices = await ctx.db
		.query('devices')
		.withIndex('by_licenseId', (q) => q.eq('licenseId', license._id))
		.collect();
	const recent = devices.filter((d) => now - d.firstSeenAt < SEVEN_DAYS_MS && !d.revokedAt);
	const distinct = new Set(recent.map((d) => d.fingerprint)).size;

	if (distinct >= DEVICE_SPRAY_SUSPEND) {
		await flagIfNew(
			ctx,
			license._id,
			'device_spray',
			`${distinct} devices in 7d`,
			'auto_suspended'
		);
		await ctx.db.patch(license._id, {
			status: 'suspended',
			suspendedAt: now,
			suspensionReason: 'device_spray'
		});
		return true;
	}
	if (distinct >= DEVICE_SPRAY_FLAG) {
		await flagIfNew(ctx, license._id, 'device_spray', `${distinct} devices in 7d`, 'none');
	}
	return false;
}

async function flagIfNew(
	ctx: MutationCtx,
	licenseId: Id<'licenses'>,
	kind: 'device_spray' | 'ip_spray' | 'trial_farming',
	details: string,
	action: 'none' | 'auto_suspended'
) {
	const open = await ctx.db
		.query('abuseFlags')
		.withIndex('by_licenseId', (q) => q.eq('licenseId', licenseId))
		.filter((q) => q.eq(q.field('resolvedAt'), undefined))
		.collect();
	if (open.some((f) => f.kind === kind)) return;
	await ctx.db.insert('abuseFlags', {
		licenseId,
		kind,
		details,
		action,
		createdAt: Date.now()
	});
}
