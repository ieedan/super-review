// Shared plumbing for the setup scripts (`setup-dev.mjs`, `setup-prod.mjs`):
// terminal helpers, prompts, secret generation, and the Convex / Vercel /
// desktop-app IO both of them need.
//
// The two scripts differ only in *where* values go (a personal dev deployment
// and .env.local, versus the production deployment, the preview defaults, and
// the Vercel project), so everything that is not target-specific lives here.
import { execSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// --- small terminal helpers --------------------------------------------------

const ESC = '\x1b[';
export const bold = (s) => `${ESC}1m${s}${ESC}0m`;
export const dim = (s) => `${ESC}2m${s}${ESC}0m`;
export const green = (s) => `${ESC}32m${s}${ESC}0m`;
export const yellow = (s) => `${ESC}33m${s}${ESC}0m`;
export const cyan = (s) => `${ESC}36m${s}${ESC}0m`;

export function heading(title) {
	console.log(`\n${bold(title)}`);
}

// Prints a multi-line description block for a complicated step so you know
// exactly what to do before being prompted.
export function describe(lines) {
	for (const line of lines) console.log(`  ${line}`);
	console.log('');
}

export function findProjectRoot(start) {
	let dir = start;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, 'convex.json')) && existsSync(join(dir, 'package.json'))) {
			return dir;
		}
		dir = dirname(dir);
	}
	throw new Error('Could not find project root (expected convex.json and package.json).');
}

export function generateSecret() {
	return randomBytes(32).toString('base64');
}

// Ed25519 keypair for signing/verifying license tokens. Private key (base64
// PKCS#8) stays in the SvelteKit env; public key (SPKI PEM) is embedded in the
// desktop app, keyed by the kid.
export function generateLicenseKeypair() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	return {
		kid: `lk_${randomBytes(4).toString('hex')}`,
		privateKeyB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
		publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()
	};
}

export function createPrompt() {
	return readline.createInterface({ input, output });
}

export async function ask(rl, question, defaultValue) {
	const suffix = defaultValue ? ` (${defaultValue})` : '';
	const answer = (await rl.question(`${question}${suffix}: `)).trim();
	return answer || defaultValue || '';
}

export async function askYesNo(rl, question, defaultYes = true) {
	const suffix = defaultYes ? ' [Y/n]' : ' [y/N]';
	const answer = (await rl.question(`${question}${suffix}: `)).trim().toLowerCase();
	if (!answer) return defaultYes;
	return answer === 'y' || answer === 'yes';
}

function askSecretRaw(question) {
	return new Promise((resolvePromise, reject) => {
		output.write(`${question}: `);
		const wasRaw = input.isRaw ?? false;
		input.setRawMode(true);
		input.resume();
		input.setEncoding('utf8');
		let value = '';
		const cleanup = () => {
			input.setRawMode(wasRaw);
			input.off('data', onData);
		};
		const onData = (chunk) => {
			for (const char of chunk) {
				// Enter / Ctrl-D: submit.
				if (char === '\r' || char === '\n' || char === '\u0004') {
					cleanup();
					output.write('\n');
					resolvePromise(value);
					return;
				}
				// Ctrl-C: cancel.
				if (char === '\u0003') {
					cleanup();
					output.write('\n');
					reject(new Error('Setup cancelled.'));
					return;
				}
				// Backspace / Delete.
				if (char === '\u007f' || char === '\b') {
					if (value.length > 0) {
						value = value.slice(0, -1);
						output.write('\b \b');
					}
					continue;
				}
				value += char;
				output.write('*');
			}
		};
		input.on('data', onData);
	});
}

// Reads a value without echoing it. Closes the readline interface first because
// raw mode and readline fight over stdin; callers re-create it afterwards with
// `rl = createPrompt()`.
export async function askSecret(rl, question) {
	rl.close();
	await new Promise((r) => setImmediate(r));
	const value = (await askSecretRaw(question)).trim();
	return value;
}

export function openUrl(url) {
	const command =
		process.platform === 'darwin'
			? `open "${url}"`
			: process.platform === 'win32'
				? `start "" "${url}"`
				: `xdg-open "${url}"`;
	try {
		execSync(command, { stdio: 'ignore' });
	} catch {
		console.log(dim(`  (could not open a browser; visit: ${url})`));
	}
}

export async function pressEnterToOpen(rl, url, label) {
	const answer = (await rl.question(`${label} ${dim('(Enter to open, s to skip)')}: `))
		.trim()
		.toLowerCase();
	if (answer !== 's' && answer !== 'skip') openUrl(url);
}

// --- env file io -------------------------------------------------------------

export function readEnvValue(envText, key) {
	const match = envText.match(new RegExp(`^${key}=(.*)$`, 'm'));
	if (!match) return null;
	return match[1].replace(/^["']|["']$/g, '').trim();
}

export function upsertEnvLocal(projectRoot, key, value) {
	const envPath = join(projectRoot, '.env.local');
	const line = `${key}="${value}"`;
	const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
	const pattern = new RegExp(`^${key}=.*$`, 'm');
	const updated = existing
		? pattern.test(existing)
			? existing.replace(pattern, line)
			: `${existing.replace(/\n?$/, '\n')}${line}\n`
		: `${line}\n`;
	writeFileSync(envPath, updated);
}

// A generated secret that's actually usable: long enough and not an empty or
// angle-bracket placeholder (e.g. "<random-32+>") copied in from .env.example.
export const isRealSecret = (v) => !!v && v.length >= 16 && !v.includes('<') && !v.includes('>');

// --- convex deployment targets ------------------------------------------------

// Which set of Convex environment variables a call reads or writes. Convex has
// per-deployment variables (dev, prod) and project-level *defaults* that are
// copied into each new deployment of a type - which is the only way to
// configure preview deployments, since they are created on demand by CI and
// have no stable name to target.
export const CONVEX_DEV = { label: 'dev deployment', args: '' };
export const CONVEX_PROD = { label: 'production deployment', args: '--prod' };
export const CONVEX_PREVIEW_DEFAULTS = {
	label: 'preview defaults',
	defaults: true,
	type: 'preview'
};

function convexEnvCommand(target, sub) {
	if (target.defaults) return `env default ${sub} --type ${target.type}`;
	return `env ${sub}${target.args ? ` ${target.args}` : ''}`;
}

export function setConvexEnv(projectRoot, variables, target = CONVEX_DEV) {
	const entries = Object.entries(variables).filter(([, v]) => v !== undefined && v !== '');
	if (entries.length === 0) return;
	const tempDir = mkdtempSync(join(tmpdir(), 'convex-setup-'));
	const envFile = join(tempDir, 'convex.env');
	try {
		writeFileSync(envFile, `${entries.map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
		execSync(`pnpm convex ${convexEnvCommand(target, 'set')} --from-file "${envFile}" --force`, {
			cwd: projectRoot,
			stdio: 'inherit'
		});
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

// Names of the variables already set on a deployment (or in a type's defaults).
// Used to detect which steps are already done (resume). Returns an empty set if
// the deployment can't be reached yet.
export function listConvexEnvNames(projectRoot, target = CONVEX_DEV) {
	try {
		const out = execSync(`pnpm convex ${convexEnvCommand(target, 'list')} --names-only`, {
			cwd: projectRoot,
			stdio: ['ignore', 'pipe', 'ignore']
		}).toString();
		return new Set(
			out
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean)
		);
	} catch {
		return new Set();
	}
}

// Reads one variable's value back off a deployment. Returns null when it isn't
// set or the deployment can't be reached, so callers can fall back to asking.
export function getConvexEnv(projectRoot, name, target = CONVEX_DEV) {
	try {
		const out = execSync(`pnpm convex ${convexEnvCommand(target, 'get')} ${name}`, {
			cwd: projectRoot,
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.toString()
			.trim();
		return out || null;
	} catch {
		return null;
	}
}

// The deployment name behind `--prod` (or any other target). The dashboard
// command prints https://dashboard.convex.dev/d/<name>, which is the only
// first-class way to learn it; the name is what the deployment's .convex.cloud
// and .convex.site URLs are built from.
export function convexDeploymentName(projectRoot, target = CONVEX_PROD) {
	try {
		const out = execSync(`pnpm convex dashboard ${target.args ?? ''} --no-open`, {
			cwd: projectRoot,
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.toString()
			.trim();
		const match = out.match(/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/i);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

// --- desktop app license public keys -----------------------------------------

const DESKTOP_PUBLIC_KEY_PATH = '../desktop/src/main/license/public-key.ts';

// The kids currently embedded in the desktop app, mapped to their PEM. Parsed
// rather than imported because the file is TypeScript.
//
// The quotes around the kid are optional because `pnpm format` removes them: a
// kid is a valid JS identifier, so prettier writes `lk_abc123:` where this
// script wrote `'lk_abc123':`. A pattern that insisted on the quotes silently
// read back an EMPTY map from every formatted file, which made
// `desktopKeyHasKid` always false and, worse, turned the
// `{ ...readDesktopPublicKeys(), [kid]: pem }` merges in setup-dev/setup-prod
// into a wipe: the next run would have dropped the production key out of the
// desktop build. Keep this tolerant of both forms.
export function readDesktopPublicKeys(projectRoot) {
	const target = resolve(projectRoot, DESKTOP_PUBLIC_KEY_PATH);
	if (!existsSync(target)) return {};
	const content = readFileSync(target, 'utf8');
	const keys = {};
	const pattern = /(?:'([^']+)'|([A-Za-z_$][\w$]*)):\s*`([^`]+)`/g;
	let match;
	while ((match = pattern.exec(content)) !== null) {
		keys[match[1] ?? match[2]] = match[3].trim();
	}
	return keys;
}

export function desktopKeyHasKid(projectRoot, kid) {
	return Object.hasOwn(readDesktopPublicKeys(projectRoot), kid);
}

// Write the public keys into the desktop app's embedded key map so the desktop
// verifies tokens the matching deployments sign. `keys` is a kid -> PEM map and
// REPLACES the file's contents, so callers that want to keep existing kids
// merge them in first (see readDesktopPublicKeys).
export function writeDesktopPublicKeys(projectRoot, keys, generatedBy) {
	const target = resolve(projectRoot, DESKTOP_PUBLIC_KEY_PATH);
	const entries = Object.entries(keys);
	if (!existsSync(target)) {
		console.log(`\nCould not find ${target}; paste these public keys there manually:`);
		for (const [kid, pem] of entries) console.log(`${kid}:\n${pem}`);
		return;
	}
	// Emitted unquoted when the kid is a valid identifier, which is the form
	// `pnpm format` normalizes to. Writing the quoted form instead left the file
	// permanently one `pnpm format` away from a diff, and it is what put the
	// reader above out of step with the file in the first place.
	const key = (kid) => (/^[A-Za-z_$][\w$]*$/.test(kid) ? kid : `'${kid}'`);
	const body = entries.map(([kid, pem]) => `\t${key(kid)}: \`${pem}\``).join(',\n');
	const content = `// Ed25519 public keys used to verify license tokens, keyed by \`kid\`. These are
// compiled into out/main and protected at rest by asar integrity + the OS code
// signature (see electron-builder.yml + scripts/after-pack.cjs). The private
// key lives ONLY in the web app's server env.
//
// To rotate: generate a new pair (apps/web/scripts/generate-license-keys.mjs),
// add the new public key here under its kid, deploy, then retire the old kid.
//
// Generated by apps/web/scripts/${generatedBy}.
export const LICENSE_PUBLIC_KEYS: Record<string, string> = {
${body}
};
`;
	writeFileSync(target, content);
	console.log(
		green(
			`  Wrote ${entries.length} license public key${entries.length === 1 ? '' : 's'} (${entries
				.map(([kid]) => kid)
				.join(', ')}) to apps/desktop/src/main/license/public-key.ts`
		)
	);
}

// --- shared constants ---------------------------------------------------------

// Repo the desktop releases are published to. Mirrors REPO in src/lib/releases.ts
// and the `publish` block in apps/desktop/electron-builder.yml.
export const RELEASES_REPO = 'ieedan/super-review';

// Deep link straight to the API key page rather than the Loops home page.
export const LOOPS_API_SETTINGS_URL = 'https://app.loops.so/settings?page=api';

// Keep in step with REFERRAL_DISCOUNT_PERCENT in src/lib/convex/invites.ts and
// with the actual Stripe coupon; this only drives the setup instructions.
export const REFERRAL_DISCOUNT_PERCENT = 15;

// The transactional emails the beta flow sends, one Loops template each. Keep
// `variables` in step with the dataVariables in src/lib/convex/email.ts: a
// template referencing a variable we don't send renders it empty.
// Variables are referenced in LMX as {data.x}, not {x}.
export const LOOPS_TEMPLATES = [
	{
		label: 'Waitlist confirmation',
		envVar: 'LOOPS_WAITLIST_TRANSACTIONAL_ID',
		purpose: 'sent when someone joins the waitlist',
		variables: '{data.waitlistUrl}'
	},
	{
		label: 'Invite code',
		envVar: 'LOOPS_INVITE_TRANSACTIONAL_ID',
		purpose: 'sent when you invite someone into the beta',
		variables: '{data.code}, {data.redeemUrl}'
	},
	{
		label: 'Guest invite from friend',
		envVar: 'LOOPS_GUEST_INVITE_TRANSACTIONAL_ID',
		purpose: 'sent when a member emails one of their guest codes to a friend',
		variables: '{data.code}, {data.redeemUrl}, {data.inviterName}'
	},
	{
		label: 'Welcome (with guest invites)',
		envVar: 'LOOPS_WELCOME_TRANSACTIONAL_ID',
		purpose: 'sent when someone redeems a BETA code and gets 3 invites',
		variables: '{data.guestCodeCount}, {data.dashboardUrl}'
	},
	{
		// Separate template because LMX has no conditionals: a guest redeemer has
		// no codes, so the "invite your friends" section has to be absent rather
		// than empty.
		label: 'Welcome (no guest invites)',
		envVar: 'LOOPS_WELCOME_GUEST_TRANSACTIONAL_ID',
		purpose: 'sent when someone redeems a GUEST code and gets none',
		variables: '{data.dashboardUrl}'
	},
	{
		label: 'Referral reward',
		envVar: 'LOOPS_REFERRAL_REWARD_TRANSACTIONAL_ID',
		purpose: "sent when all of a member's guest codes have been redeemed",
		variables: '{data.percentOff}, {data.pricingUrl}'
	}
];

// Everything the feedback bot needs and nothing more: VIEW_CHANNEL (1<<10),
// SEND_MESSAGES (1<<11), EMBED_LINKS (1<<14), CREATE_PUBLIC_THREADS (1<<35).
// Note 2**35 rather than 1<<35: `<<` is a 32-bit operator in JS, so 1<<35
// silently wraps to 8. EMBED_LINKS is in there because without it a bot's rich
// embed is stripped to an empty message.
export const FEEDBACK_BOT_PERMISSIONS = String((1 << 10) + (1 << 11) + (1 << 14) + 2 ** 35);

// The 6 Stripe events the better-auth Stripe plugin and our billing hooks act
// on. Listed here so the dev and prod scripts can never drift apart.
export const STRIPE_WEBHOOK_EVENTS = [
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'charge.refunded',
	'charge.dispute.created'
];

// Default LAUNCH_CUTOFF when setting up from scratch: 30 days out, which is a
// plausible launch window and, more importantly, not in the past.
export function defaultLaunchCutoff() {
	const d = new Date();
	d.setDate(d.getDate() + 30);
	return d.toISOString().slice(0, 10);
}

// --- credential verification --------------------------------------------------

// Confirm a releases token can actually read the repo's releases. Never throws:
// a bad token shouldn't abort setup, it should just tell you what's wrong.
export async function verifyReleasesToken(token) {
	try {
		const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
			headers: {
				authorization: `Bearer ${token}`,
				accept: 'application/vnd.github+json',
				'x-github-api-version': '2022-11-28'
			}
		});
		if (res.ok) {
			const release = await res.json();
			console.log(green(`  Verified: can read releases (latest is ${release.tag_name}).`));
			return;
		}
		if (res.status === 404) {
			console.log(
				dim(
					`  Warning: got 404 for ${RELEASES_REPO}. Either the token doesn't grant access\n` +
						'  to that repo (check Contents: Read-only), or no release is published yet.'
				)
			);
			return;
		}
		if (res.status === 401) {
			console.log(dim('  Warning: GitHub rejected the token (401). It may be mistyped.'));
			return;
		}
		console.log(dim(`  Warning: GitHub returned ${res.status} when checking the token.`));
	} catch {
		console.log(dim('  Could not reach GitHub to verify the token; skipping the check.'));
	}
}

// Checks the Loops key against the real endpoint now, rather than letting a
// mistyped key surface later as invites that silently never arrive.
export async function verifyLoopsKey(key) {
	try {
		const res = await fetch('https://app.loops.so/api/v1/api-key', {
			headers: { authorization: `Bearer ${key}`, accept: 'application/json' }
		});
		if (res.ok) {
			const body = await res.json().catch(() => ({}));
			console.log(
				green(`  Verified: Loops key is valid${body.teamName ? ` (${body.teamName})` : ''}.`)
			);
			return;
		}
		if (res.status === 401) {
			console.log(dim('  Warning: Loops rejected the key (401). It may be mistyped.'));
			return;
		}
		console.log(dim(`  Warning: Loops returned ${res.status} when checking the key.`));
	} catch {
		console.log(dim('  Could not reach Loops to verify the key; skipping the check.'));
	}
}

// Confirms the bot token is valid by asking Discord who it belongs to, and
// returns the bot's id (which for a bot user IS the application id, so the
// invite URL can be built without asking for a client id separately).
//
// A valid token does NOT prove the bot is in your server or can see the target
// channel; a wrong invite shows up as a 403 in the Convex logs on the first
// report.
export async function verifyDiscordBot(token) {
	try {
		const res = await fetch('https://discord.com/api/v10/users/@me', {
			headers: { authorization: `Bot ${token}` }
		});
		if (res.ok) {
			const me = await res.json().catch(() => ({}));
			console.log(
				green(`  Verified: bot token is valid${me.username ? ` (${me.username})` : ''}.`)
			);
			return me.id ?? null;
		}
		if (res.status === 401) {
			console.log(dim('  Warning: Discord rejected the bot token (401). It may be mistyped.'));
			return null;
		}
		console.log(dim(`  Warning: Discord returned ${res.status} when checking the bot token.`));
		return null;
	} catch {
		console.log(dim('  Could not reach Discord to verify the bot token; skipping the check.'));
		return null;
	}
}

/**
 * Checks that the bot can actually reach the channel it is about to be pointed
 * at, and that it may open threads there.
 *
 * A valid token says nothing about access: the usual way feedback goes missing
 * is a bot that was never added to the server, a channel id copied from the
 * wrong place, or a private channel whose permission overwrites grant the bot
 * View Channel and Send Messages but not Create Public Threads. All three look
 * identical from here (reports stored, nothing in Discord) unless somebody
 * reads the Convex logs, so they are worth catching while you are still sat in
 * the setup script.
 *
 * Warns rather than blocks: the permission bits Discord reports are the ones
 * the bot has right now, and granting the missing one is a change you make in
 * Discord afterwards, not a reason to abandon the step.
 */
// CREATE_PUBLIC_THREADS. `2n ** 35n` because the permissions field is a
// stringified 64-bit integer, well past what Number can mask precisely.
const CREATE_PUBLIC_THREADS_BIT = 2n ** 35n;

export async function verifyDiscordChannel(token, channelId) {
	try {
		const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
			headers: { authorization: `Bot ${token}` }
		});
		if (res.status === 403 || res.status === 404) {
			console.log(
				dim(
					`  Warning: the bot cannot see channel ${channelId} (${res.status}). Add it to the\n` +
						'  server, and make sure it can view that channel, or feedback will be stored\n' +
						'  but never posted.'
				)
			);
			return false;
		}
		if (!res.ok) {
			console.log(dim(`  Warning: Discord returned ${res.status} when checking the channel.`));
			return false;
		}
		const channel = await res.json().catch(() => ({}));
		console.log(
			green(`  Verified: the bot can see the channel${channel.name ? ` (#${channel.name})` : ''}.`)
		);

		// permissions is only present when Discord resolved them for this bot; a
		// missing field is not evidence of anything either way.
		if (typeof channel.permissions === 'string') {
			const granted = BigInt(channel.permissions);
			if ((granted & CREATE_PUBLIC_THREADS_BIT) === 0n) {
				console.log(
					dim(
						'  Warning: the bot lacks Create Public Threads in that channel. Reports will\n' +
							'  post, but each one will arrive without its thread.'
					)
				);
				return false;
			}
		}
		return true;
	} catch {
		console.log(dim('  Could not reach Discord to verify the channel; skipping the check.'));
		return false;
	}
}

// Checks a Stripe secret key by asking Stripe for the account behind it, and
// reports whether it is a live or test key so a test key can't quietly end up
// on production. Returns 'live' | 'test' | null.
export async function verifyStripeKey(key) {
	const mode = key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test';
	try {
		const res = await fetch('https://api.stripe.com/v1/account', {
			headers: { authorization: `Bearer ${key}` }
		});
		if (res.ok) {
			const account = await res.json().catch(() => ({}));
			const name = account.settings?.dashboard?.display_name ?? account.id ?? '';
			console.log(green(`  Verified: Stripe ${mode} key is valid${name ? ` (${name})` : ''}.`));
			return mode;
		}
		if (res.status === 401) {
			console.log(dim('  Warning: Stripe rejected the key (401). It may be mistyped.'));
			return null;
		}
		console.log(dim(`  Warning: Stripe returned ${res.status} when checking the key.`));
		return null;
	} catch {
		console.log(dim('  Could not reach Stripe to verify the key; skipping the check.'));
		return null;
	}
}

// --- step runner --------------------------------------------------------------

// Builds the `step(title, isDone, run)` helper both scripts drive their flow
// with. A step runs unless (not fresh) and it's already done. With --only, just
// the matching steps run and the "already configured" check is bypassed for
// them, so you can redo one step in isolation. `matched()` reports how many
// steps --only actually selected, so a typo doesn't look like a clean run.
export function createStepRunner({ fresh = false, only = null } = {}) {
	let onlyMatched = 0;
	const step = async (title, isDone, run) => {
		if (only) {
			if (!title.toLowerCase().includes(only)) return;
			onlyMatched++;
			heading(title);
			await run();
			return;
		}
		if (!fresh && isDone()) {
			console.log(`${green('  done')}  ${title} ${dim('(already configured, skipping)')}`);
			return;
		}
		heading(title);
		await run();
	};
	return { step, matched: () => onlyMatched };
}

// Parses the `--fresh` / `--only <text>` flags both scripts accept. Exits on a
// malformed --only rather than silently running everything.
export function parseSetupArgs(args) {
	const fresh = args.includes('--fresh') || args.includes('--no-resume');
	const onlyIndex = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
	let only = null;
	if (onlyIndex !== -1) {
		const arg = args[onlyIndex];
		only = (arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[onlyIndex + 1] || '')
			.trim()
			.toLowerCase();
		if (!only) {
			console.error('\n--only needs a value, e.g. `--only stripe`.');
			process.exit(1);
		}
	}
	return { fresh, only };
}
