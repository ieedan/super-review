// Environment for Convex functions.
//
// This is read lazily via getters over `process.env` rather than validated
// eagerly with a schema. Convex's push-time module *analysis* runs in an
// isolate that has NO environment variables, and it imports this module through
// the better-auth component's adapter (betterAuth/adapter.ts -> ../auth ->
// here). An eager, throwing validator (t3-env `createEnv`) therefore fails the
// push with "Invalid environment variables ... received undefined", even though
// the vars are set on the deployment and present at real runtime.
//
// Getters defer the read to the moment a value is actually used (runtime, where
// the vars exist), so importing/analyzing the module never throws. The vars are
// still required in practice; a missing one surfaces as an empty string at the
// call site (e.g. Stripe / better-auth erroring) rather than crashing the push.

function str(name: string): string {
	return process.env[name] ?? '';
}

export const env = {
	get FUNCTION_SECRET() {
		return str('FUNCTION_SECRET');
	},
	get BETTER_AUTH_SECRET() {
		return str('BETTER_AUTH_SECRET');
	},
	get SITE_URL() {
		return str('SITE_URL');
	},
	get GITHUB_CLIENT_ID() {
		return str('GITHUB_CLIENT_ID');
	},
	get GITHUB_CLIENT_SECRET() {
		return str('GITHUB_CLIENT_SECRET');
	},
	get STRIPE_SECRET_KEY() {
		return str('STRIPE_SECRET_KEY');
	},
	get STRIPE_WEBHOOK_SECRET() {
		return str('STRIPE_WEBHOOK_SECRET');
	},
	// The standing one-time Stripe price for the perpetual license, the only
	// thing Super Review sells.
	get STRIPE_PRICE_LIFETIME() {
		return str('STRIPE_PRICE_LIFETIME');
	},
	// The discounted launch price, charged instead while LAUNCH_CUTOFF is in the
	// future. Optional: unset falls back to STRIPE_PRICE_LIFETIME, so a
	// half-configured deployment overcharges rather than undercharges.
	get STRIPE_PRICE_LAUNCH() {
		return str('STRIPE_PRICE_LAUNCH');
	},
	// Exclusive instant the launch price ends; after it, everyone pays
	// STRIPE_PRICE_LIFETIME. Unset means the window is shut (see isLaunchOpen).
	get LAUNCH_CUTOFF() {
		return str('LAUNCH_CUTOFF');
	},
	get TRIAL_DAYS() {
		const raw = process.env.TRIAL_DAYS;
		const n = raw ? Number(raw) : 7;
		return Number.isFinite(n) ? n : 7;
	},
	// Salt for hashing client IPs before storing them (abuse detection).
	get IP_HASH_SALT() {
		return str('IP_HASH_SALT');
	},
	// Discord bot that posts in-app feedback and opens a thread on each report.
	// Both are needed together; with either unset, feedback is still stored and
	// just logged to the Convex console instead of posted.
	//
	// A bot rather than an incoming webhook because opening a thread on a message
	// is POST /channels/{id}/messages/{id}/threads on the main REST API, which
	// only accepts a bot token. Using the bot for the message too keeps it to one
	// credential instead of two.
	get FEEDBACK_BOT_TOKEN() {
		return str('FEEDBACK_BOT_TOKEN');
	},
	// Discord channel id the reports go to (right-click the channel > Copy
	// Channel ID, with Developer Mode on).
	get FEEDBACK_CHANNEL_ID() {
		return str('FEEDBACK_CHANNEL_ID');
	},
	// Loops (email). Both are optional: without them the invite flow still mints
	// codes, it just logs them instead of sending, so local dev needs no account.
	get LOOPS_API_KEY() {
		return str('LOOPS_API_KEY');
	},
	// Ids of the published transactional templates in Loops. Each is independent:
	// an unset one means that particular email is not configured yet, and the
	// others still send.
	get LOOPS_WAITLIST_TRANSACTIONAL_ID() {
		return str('LOOPS_WAITLIST_TRANSACTIONAL_ID');
	},
	get LOOPS_INVITE_TRANSACTIONAL_ID() {
		return str('LOOPS_INVITE_TRANSACTIONAL_ID');
	},
	// Friend invite: a beta member emails one of their guest codes. Separate from
	// LOOPS_INVITE_TRANSACTIONAL_ID because LMX has no conditionals, and the copy
	// names the person who sent it.
	get LOOPS_GUEST_INVITE_TRANSACTIONAL_ID() {
		return str('LOOPS_GUEST_INVITE_TRANSACTIONAL_ID');
	},
	get LOOPS_REFERRAL_REWARD_TRANSACTIONAL_ID() {
		return str('LOOPS_REFERRAL_REWARD_TRANSACTIONAL_ID');
	},
	// Stripe coupon applied at checkout for members who earned the referral
	// reward. Stripe is the source of truth for the actual percentage; the
	// REFERRAL_DISCOUNT_PERCENT constant only drives what we advertise, so the
	// two must be kept in step.
	get STRIPE_REFERRAL_COUPON_ID() {
		return str('STRIPE_REFERRAL_COUPON_ID');
	}
};
