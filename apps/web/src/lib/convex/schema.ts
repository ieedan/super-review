import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const licensePlan = v.union(
	v.literal('none'),
	v.literal('trial'),
	v.literal('monthly'),
	v.literal('annual'),
	v.literal('lifetime')
);

export const licenseStatus = v.union(
	v.literal('inactive'),
	v.literal('trialing'),
	v.literal('active'),
	v.literal('expired'),
	v.literal('suspended')
);

// App-owned tables. better-auth's tables live inside the betterAuth component
// (see betterAuth/schema.ts), not here.
export default defineSchema({
	// Singleton row (key: 'app') holding runtime flags the marketing site reads.
	// Kept in the database rather than an env var so flipping waitlist mode takes
	// effect immediately from the Convex dashboard, with no redeploy.
	settings: defineTable({
		key: v.literal('app'),
		// true = the site presents itself as pre-launch: the hero shows the
		// waitlist form and pricing is hidden. Sign-in, checkout, activation, and
		// the desktop license API are unaffected.
		waitlistMode: v.boolean(),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// The waitlist: just emails, so joining costs one field and no OAuth. These
	// are unverified addresses and grant nothing on their own. Access comes from
	// redeeming an invite code (below), which is what ties a real GitHub account
	// to an invitation without needing the two emails to match.
	waitlistSignups: defineTable({
		email: v.string(),
		createdAt: v.number(),
		// Set when a beta code has been minted for this address, so the invite
		// sweep can skip them. Doubles as "have we contacted this person yet".
		invitedAt: v.optional(v.number()),
		// Set on rows carried over from the pre-Convex Upstash waitlist by
		// `waitlistImport`. Absent means they signed up here, on this list.
		importedFrom: v.optional(v.literal('upstash')),
		// When the "you're on the list" email went out. Only imported rows carry
		// it: the import brings people over and mails them in two separate runs,
		// and this is what stops the mailing run from reaching anyone twice.
		// Rows created by the signup form email immediately and leave it unset.
		confirmationSentAt: v.optional(v.number())
	})
		.index('by_email', ['email'])
		// Invite in signup order, and find the not-yet-invited without a full scan.
		.index('by_invitedAt_createdAt', ['invitedAt', 'createdAt'])
		// Imported rows still owed a confirmation email, without a full scan.
		.index('by_importedFrom_confirmationSentAt', ['importedFrom', 'confirmationSentAt']),

	// Single-use invitations.
	//
	// `beta` codes are minted by you against a waitlist email and emailed out.
	// `guest` codes are minted automatically for someone who redeems a beta code,
	// to hand to friends. Guest codes deliberately do NOT mint further guest
	// codes: that keeps growth linear (each wave tops out at 4x) instead of
	// compounding beyond anything you can pull back.
	inviteCodes: defineTable({
		// Stored uppercase, in a confusable-free alphabet, since humans retype it.
		code: v.string(),
		kind: v.union(v.literal('beta'), v.literal('guest')),
		// beta codes: the waitlist address this was minted for and mailed to.
		issuedToEmail: v.optional(v.string()),
		// guest codes: the member who owns it and can see it on their dashboard.
		issuedByUserId: v.optional(v.string()),
		createdAt: v.number(),
		redeemedByUserId: v.optional(v.string()),
		redeemedByGithubAccountId: v.optional(v.string()),
		redeemedAt: v.optional(v.number()),
		revokedAt: v.optional(v.number())
	})
		.index('by_code', ['code'])
		.index('by_issuedByUserId', ['issuedByUserId'])
		.index('by_issuedToEmail', ['issuedToEmail']),

	// Who is actually in the beta. Keyed by GitHub account id, so membership
	// survives the user deleting and recreating their better-auth account (and
	// so a second account cannot inherit it).
	betaMembers: defineTable({
		githubAccountId: v.string(),
		userId: v.string(),
		email: v.string(),
		joinedAt: v.number(),
		// Which invitation let them in, kept for auditing an invite tree.
		viaCode: v.string(),
		viaCodeKind: v.union(v.literal('beta'), v.literal('guest')),
		// Set once all of this member's guest codes have been redeemed, which earns
		// a permanent discount at checkout. Lives here rather than on `licenses`
		// because a license row only exists after first activation, and the reward
		// can be earned before that.
		//
		// It never expires; the programme instead closes on its own, because invite
		// codes stop being redeemable when waitlist mode is turned off.
		referralRewardEarnedAt: v.optional(v.number())
	})
		.index('by_githubAccountId', ['githubAccountId'])
		.index('by_userId', ['userId']),

	// One row per user. `githubAccountId` is the GitHub OAuth account id, the
	// stable anti-trial-farming key (deleting and recreating the better-auth
	// user does not reset it).
	licenses: defineTable({
		userId: v.string(),
		githubAccountId: v.string(),
		plan: licensePlan,
		status: licenseStatus,
		trialStartedAt: v.optional(v.number()),
		trialEndsAt: v.optional(v.number()),
		stripeCustomerId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),
		currentPeriodEnd: v.optional(v.number()),
		// True when Stripe has the subscription set to cancel at period end, so
		// the dashboard can show "Cancels <date>" instead of "Renews <date>".
		cancelAtPeriodEnd: v.optional(v.boolean()),
		// When the subscription first became active; survives renewals so the
		// dashboard card can show how long the holder has been a member.
		subscribedAt: v.optional(v.number()),
		lifetimePurchasedAt: v.optional(v.number()),
		suspendedAt: v.optional(v.number()),
		suspensionReason: v.optional(v.string())
	})
		.index('by_userId', ['userId'])
		.index('by_githubAccountId', ['githubAccountId'])
		.index('by_stripeCustomerId', ['stripeCustomerId']),

	// Forever record of consumed trials, keyed by GitHub account id. Rows are
	// never deleted, even when the user account is; that is the point.
	trials: defineTable({
		githubAccountId: v.string(),
		userId: v.string(),
		startedAt: v.number(),
		endsAt: v.number()
	}).index('by_githubAccountId', ['githubAccountId']),

	devices: defineTable({
		licenseId: v.id('licenses'),
		fingerprint: v.string(),
		fingerprintSource: v.union(v.literal('os'), v.literal('fallback')),
		name: v.optional(v.string()),
		platform: v.string(),
		appVersion: v.string(),
		firstSeenAt: v.number(),
		lastSeenAt: v.number(),
		lastIpHash: v.optional(v.string()),
		validationCount: v.number(),
		revokedAt: v.optional(v.number())
	})
		.index('by_licenseId', ['licenseId'])
		.index('by_license_fingerprint', ['licenseId', 'fingerprint'])
		.index('by_fingerprint', ['fingerprint']),

	// Device-authorization-grant codes. The desktop requests a pair on start:
	// a short `userCode` (the human types it into the browser) and a secret
	// high-entropy `deviceCode` (the desktop polls with it). Only the SHA-256
	// hashes are stored; the raw codes never touch the database. The row is
	// created pending, gets a `userId` + `approvedAt` when the signed-in user
	// approves it in the browser (or `deniedAt` when rejected), and is consumed
	// by the first successful poll after approval.
	activationCodes: defineTable({
		userCodeHash: v.string(),
		deviceCodeHash: v.string(),
		// Captured at start so the approval page can show what is being authorized
		// and the poll can bind the token to the same machine.
		fingerprint: v.string(),
		fingerprintSource: v.union(v.literal('os'), v.literal('fallback')),
		machineName: v.optional(v.string()),
		platform: v.optional(v.string()),
		appVersion: v.optional(v.string()),
		userId: v.optional(v.string()),
		approvedAt: v.optional(v.number()),
		deniedAt: v.optional(v.number()),
		createdAt: v.number(),
		expiresAt: v.number(),
		consumedAt: v.optional(v.number())
	})
		.index('by_userCodeHash', ['userCodeHash'])
		.index('by_deviceCodeHash', ['deviceCodeHash']),

	// Long-lived desktop refresh tokens, stored hashed (a DB leak yields nothing
	// replayable). Revocable per device from the dashboard.
	deviceTokens: defineTable({
		tokenHash: v.string(),
		licenseId: v.id('licenses'),
		userId: v.string(),
		deviceId: v.id('devices'),
		createdAt: v.number(),
		lastUsedAt: v.number(),
		revokedAt: v.optional(v.number())
	})
		.index('by_tokenHash', ['tokenHash'])
		.index('by_licenseId', ['licenseId'])
		.index('by_userId', ['userId'])
		.index('by_deviceId', ['deviceId']),

	// Raw material for abuse detection; pruned after 14 days by cron.
	validationEvents: defineTable({
		licenseId: v.id('licenses'),
		deviceId: v.id('devices'),
		ipHash: v.optional(v.string()),
		appVersion: v.string(),
		at: v.number()
	}).index('by_license_at', ['licenseId', 'at']),

	// In-app feedback (bug reports, ideas, anything else) submitted from the
	// desktop app's feedback dialog. Deliberately open to unauthenticated
	// submissions: someone whose license or activation is broken is exactly the
	// person who most needs to reach us, so requiring a device token would lose
	// the reports that matter most. Spam is bounded by the rate limiter.
	feedback: defineTable({
		category: v.union(v.literal('bug'), v.literal('idea'), v.literal('other')),
		title: v.string(),
		body: v.string(),
		// Optional reply-to the reporter typed in. Unverified, and absent for most
		// submissions; it is the only follow-up channel an anonymous reporter has.
		email: v.optional(v.string()),
		// What the user was doing, when the report came from an error toast.
		// Every field is optional because the capture is best effort. Note that
		// `repo` and `branch` are the reporter's own names, so this row can carry
		// the name of a private repository.
		context: v.optional(
			v.object({
				action: v.optional(v.string()),
				tab: v.optional(v.string()),
				repo: v.optional(v.string()),
				branch: v.optional(v.string()),
				location: v.optional(v.string())
			})
		),
		// Client metadata, set by the desktop main process (not the renderer).
		appVersion: v.string(),
		platform: v.string(),
		osRelease: v.string(),
		arch: v.optional(v.string()),
		electronVersion: v.optional(v.string()),
		// Attribution, filled in only when the submission carried a valid device
		// token. Absent means anonymous, not invalid.
		userId: v.optional(v.string()),
		licenseId: v.optional(v.id('licenses')),
		// Salted hash, same scheme as validationEvents: enough to correlate a spam
		// burst without storing an address.
		ipHash: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_createdAt', ['createdAt']),

	abuseFlags: defineTable({
		licenseId: v.id('licenses'),
		kind: v.union(v.literal('device_spray'), v.literal('ip_spray'), v.literal('trial_farming')),
		details: v.string(),
		action: v.union(v.literal('none'), v.literal('auto_suspended')),
		createdAt: v.number(),
		resolvedAt: v.optional(v.number())
	})
		.index('by_licenseId', ['licenseId'])
		.index('by_createdAt', ['createdAt'])
});
