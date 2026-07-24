// Forwards Stripe webhook events to the local Convex deployment's webhook
// endpoint via the Stripe CLI. The deployment URL is read from .env.local, so
// this works for whatever Convex dev deployment `setup:dev` configured.
//
// NOT PART OF THE DEV FLOW ANY MORE, and not safe to run alongside it. Dev now
// uses a dashboard webhook endpoint pointed straight at the Convex deployment
// (see docs/LICENSING.md), because that keeps delivering when nothing is
// running locally and Stripe retries failures for 3 days.
//
// `stripe listen` signs forwarded events with the CLI's OWN signing secret,
// which is NOT the dashboard endpoint's secret, and STRIPE_WEBHOOK_SECRET can
// only hold one of them. So running this while the dashboard endpoint exists
// delivers every event twice, and the copy signed with the wrong secret fails
// verification with "No signatures found matching the expected signature".
//
// Kept only as a manual escape hatch (`pnpm stripe:listen`) for the case where
// you deliberately have no dashboard endpoint. If you use it, point
// STRIPE_WEBHOOK_SECRET at `stripe listen --print-secret` and disable the
// dashboard endpoint first.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESC = '\x1b[';
const dim = (s) => `${ESC}2m${s}${ESC}0m`;
const yellow = (s) => `${ESC}33m${s}${ESC}0m`;

function findWebRoot(start) {
	let dir = start;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, 'convex.json')) && existsSync(join(dir, 'package.json'))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return null;
}

function readEnvValue(envText, key) {
	const match = envText.match(new RegExp(`^${key}=(.*)$`, 'm'));
	if (!match) return null;
	return match[1].replace(/^["']|["']$/g, '').trim();
}

function stripeInstalled() {
	const res = spawnSync('stripe', ['--version'], { stdio: 'ignore' });
	return !res.error && res.status === 0;
}

const webRoot = findWebRoot(dirname(fileURLToPath(import.meta.url)));
if (!webRoot) {
	console.error('Could not locate apps/web (expected convex.json + package.json).');
	process.exit(1);
}

const envPath = join(webRoot, '.env.local');
if (!existsSync(envPath)) {
	console.error('No .env.local found. Run `pnpm convex dev --once` then `pnpm setup:dev` first.');
	process.exit(1);
}

const envText = readFileSync(envPath, 'utf8');
let siteUrl = readEnvValue(envText, 'PUBLIC_CONVEX_SITE_URL');
if (!siteUrl) {
	const cloud = readEnvValue(envText, 'PUBLIC_CONVEX_URL');
	siteUrl = cloud ? cloud.replace('.convex.cloud', '.convex.site') : null;
}
if (!siteUrl) {
	console.error(
		'PUBLIC_CONVEX_SITE_URL / PUBLIC_CONVEX_URL missing from .env.local. Run `pnpm setup:dev`.'
	);
	process.exit(1);
}

if (!stripeInstalled()) {
	console.error(
		yellow('The Stripe CLI is not installed, so webhook forwarding is unavailable.\n') +
			'Install it (https://stripe.com/docs/stripe-cli), run `stripe login`, then\n' +
			're-run `pnpm setup:dev` so STRIPE_WEBHOOK_SECRET matches the CLI secret.'
	);
	process.exit(1);
}

const forwardTo = `${siteUrl}/api/auth/stripe/webhook`;
console.log(dim(`stripe listen --forward-to ${forwardTo}`));

// Inherit stdio so the CLI's live event log shows in the bizi pane. Forward
// termination so bizi can stop it cleanly.
const child = spawn('stripe', ['listen', '--forward-to', forwardTo], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => child.kill(sig));
}
