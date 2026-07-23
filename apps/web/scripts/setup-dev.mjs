// Interactive dev setup for the Super Review licensing backend.
//
// Adapted from the convex-app template's setup-dev script for our environment:
// GitHub-only auth, Stripe products/prices/webhook, an Ed25519 license-signing
// keypair, the releases token behind the desktop download links, and the
// launch-window / trial config. It generates the secrets,
// prompts for the external ones, writes the SvelteKit .env.local and the Convex
// deployment env (they share FUNCTION_SECRET / LAUNCH_CUTOFF / IP_HASH_SALT),
// and drops the generated public key into the desktop app.
//
// RESUMABLE: each step writes its result to its real destination (.env.local or
// the Convex deployment env) as soon as it finishes, and on the next run a step
// is skipped when its output already exists. So if you quit partway through,
// just re-run `pnpm setup:dev` and it picks up where you left off. Pass --fresh
// (alias --no-resume) to re-run every step and overwrite existing values, or
// --only <text> to redo just the steps whose title matches (e.g.
// `--only stripe`) without disturbing the others.
//
// Prerequisite: run `pnpm convex dev --once` first so .env.local exists with a
// PUBLIC_CONVEX_URL. Run this from apps/web with `pnpm setup:dev`.
import { execSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

// --- small terminal helpers --------------------------------------------------

const ESC = '\x1b[';
const bold = (s) => `${ESC}1m${s}${ESC}0m`;
const dim = (s) => `${ESC}2m${s}${ESC}0m`;
const green = (s) => `${ESC}32m${s}${ESC}0m`;
const cyan = (s) => `${ESC}36m${s}${ESC}0m`;

function heading(title) {
	console.log(`\n${bold(title)}`);
}

// Prints a multi-line description block for a complicated step so you know
// exactly what to do before being prompted.
function describe(lines) {
	for (const line of lines) console.log(`  ${line}`);
	console.log('');
}

function findProjectRoot(start) {
	let dir = start;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, 'convex.json')) && existsSync(join(dir, 'package.json'))) {
			return dir;
		}
		dir = dirname(dir);
	}
	throw new Error('Could not find project root (expected convex.json and package.json).');
}

function generateSecret() {
	return randomBytes(32).toString('base64');
}

// Ed25519 keypair for signing/verifying license tokens. Private key (base64
// PKCS#8) stays in the SvelteKit env; public key (SPKI PEM) is embedded in the
// desktop app, keyed by the kid.
function generateLicenseKeypair() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	return {
		kid: `lk_${randomBytes(4).toString('hex')}`,
		privateKeyB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
		publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()
	};
}

function createPrompt() {
	return readline.createInterface({ input, output });
}

async function ask(rl, question, defaultValue) {
	const suffix = defaultValue ? ` (${defaultValue})` : '';
	const answer = (await rl.question(`${question}${suffix}: `)).trim();
	return answer || defaultValue || '';
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

async function askSecret(rl, question) {
	rl.close();
	await new Promise((r) => setImmediate(r));
	const value = (await askSecretRaw(question)).trim();
	return value;
}

function openUrl(url) {
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

async function pressEnterToOpen(rl, url, label) {
	const answer = (await rl.question(`${label} ${dim('(Enter to open, s to skip)')}: `))
		.trim()
		.toLowerCase();
	if (answer !== 's' && answer !== 'skip') openUrl(url);
}

// --- env file + convex env io ------------------------------------------------

function readEnvValue(envText, key) {
	const match = envText.match(new RegExp(`^${key}=(.*)$`, 'm'));
	if (!match) return null;
	return match[1].replace(/^["']|["']$/g, '').trim();
}

function upsertEnvLocal(projectRoot, key, value) {
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

function setConvexEnv(projectRoot, variables) {
	const entries = Object.entries(variables).filter(([, v]) => v !== undefined && v !== '');
	if (entries.length === 0) return;
	const tempDir = mkdtempSync(join(tmpdir(), 'convex-setup-'));
	const envFile = join(tempDir, 'convex.env');
	try {
		writeFileSync(envFile, `${entries.map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
		execSync(`pnpm convex env set --from-file "${envFile}" --force`, {
			cwd: projectRoot,
			stdio: 'inherit'
		});
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

// Names of the variables already set on the Convex dev deployment. Used to
// detect which steps are already done (resume). Returns an empty set if the
// deployment can't be reached yet.
function listConvexEnvNames(projectRoot) {
	try {
		const out = execSync('pnpm convex env list --names-only', {
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

// Write the generated public key into the desktop app's embedded key map so
// the desktop verifies tokens this deployment signs.
function writeDesktopPublicKey(projectRoot, kid, publicKeyPem) {
	const target = resolve(projectRoot, '../desktop/src/main/license/public-key.ts');
	if (!existsSync(target)) {
		console.log(`\nCould not find ${target}; paste this public key there manually:`);
		console.log(publicKeyPem);
		return;
	}
	const content = `// Ed25519 public keys used to verify license tokens, keyed by \`kid\`. These are
// compiled into out/main and protected at rest by asar integrity + the OS code
// signature (see electron-builder.yml + scripts/after-pack.cjs). The private
// key lives ONLY in the web app's server env.
//
// To rotate: generate a new pair (apps/web/scripts/generate-license-keys.mjs),
// add the new public key here under its kid, deploy, then retire the old kid.
//
// Generated by apps/web/scripts/setup-dev.mjs.
export const LICENSE_PUBLIC_KEYS: Record<string, string> = {
	'${kid}': \`${publicKeyPem}\`
};
`;
	writeFileSync(target, content);
	console.log(
		green(`  Wrote the license public key (${kid}) to apps/desktop/src/main/license/public-key.ts`)
	);
}

function desktopKeyHasKid(projectRoot, kid) {
	const target = resolve(projectRoot, '../desktop/src/main/license/public-key.ts');
	if (!existsSync(target)) return false;
	return readFileSync(target, 'utf8').includes(`'${kid}'`);
}

// Repo the desktop releases are published to. Mirrors REPO in src/lib/releases.ts
// and the `publish` block in apps/desktop/electron-builder.yml.
const RELEASES_REPO = 'ieedan/super-review';

// Deep link straight to the API key page rather than the Loops home page.
const LOOPS_API_SETTINGS_URL = 'https://app.loops.so/settings?page=api';

// Keep in step with REFERRAL_DISCOUNT_PERCENT in src/lib/convex/invites.ts and
// with the actual Stripe coupon; this only drives the setup instructions.
const REFERRAL_DISCOUNT_PERCENT = 15;

// The transactional emails the beta flow sends, one Loops template each. Keep
// `variables` in step with the dataVariables in src/lib/convex/email.ts: a
// template referencing a variable we don't send renders it empty.
// Variables are referenced in LMX as {data.x}, not {x}.
const LOOPS_TEMPLATES = [
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
		purpose: "sent when a member emails one of their guest codes to a friend",
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

// Confirm a releases token can actually read the repo's releases. Never throws:
// a bad token shouldn't abort setup, it should just tell you what's wrong.
async function verifyReleasesToken(token) {
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
async function verifyLoopsKey(key) {
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
async function verifyDiscordBot(token) {
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

// Everything the bot needs and nothing more: VIEW_CHANNEL (1<<10),
// SEND_MESSAGES (1<<11), EMBED_LINKS (1<<14), CREATE_PUBLIC_THREADS (1<<35).
// Note 2**35 rather than 1<<35: `<<` is a 32-bit operator in JS, so 1<<35
// silently wraps to 8. EMBED_LINKS is in there because without it a bot's rich
// embed is stripped to an empty message.
const FEEDBACK_BOT_PERMISSIONS = String((1 << 10) + (1 << 11) + (1 << 14) + 2 ** 35);

function defaultLaunchCutoff() {
	const d = new Date();
	d.setDate(d.getDate() + 30);
	return d.toISOString().slice(0, 10);
}

// --- main --------------------------------------------------------------------

async function main() {
	const args = process.argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) {
		console.log(`Super Review licensing dev setup

Usage: pnpm setup:dev [--fresh] [--only <text>]

Resumable by default: re-running skips steps whose output already exists
(values already in .env.local or on the Convex deployment).

  --fresh, --no-resume   Re-run every step and overwrite existing values.
  --only <text>          Run only the steps whose title contains <text>, and
                         re-run them even if already configured. Use this to
                         redo one thing without touching the rest, e.g.
                         \`--only stripe\` to re-enter the webhook secret.
                         (--fresh would also regenerate the license keypair,
                         invalidating tokens already issued.)
  --help, -h             Show this help.

Prerequisite: run \`pnpm convex dev --once\` first.`);
		return;
	}
	const fresh = args.includes('--fresh') || args.includes('--no-resume');
	// `--only stripe` or `--only=stripe`
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

	const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
	const envLocalPath = join(projectRoot, '.env.local');

	console.log(bold('Super Review licensing dev setup'));
	if (only) console.log(dim(`(--only ${only}: running just the matching steps)`));
	else if (fresh) console.log(dim('(--fresh: re-running every step)'));
	else console.log(dim('(resumable: finished steps are skipped; pass --fresh to redo them)'));

	if (!existsSync(envLocalPath)) {
		console.error(
			'\nNo .env.local found. Run `pnpm convex dev --once` first to create a Convex project.'
		);
		process.exit(1);
	}

	const convexUrl = readEnvValue(readFileSync(envLocalPath, 'utf8'), 'PUBLIC_CONVEX_URL');
	if (!convexUrl) {
		console.error(
			'\nPUBLIC_CONVEX_URL is missing from .env.local. Run `pnpm convex dev --once` first.'
		);
		process.exit(1);
	}
	const convexSiteUrl = convexUrl.replace('.convex.cloud', '.convex.site');
	const webhookUrl = `${convexSiteUrl}/api/auth/stripe/webhook`;

	const localHas = (key) => readEnvValue(readFileSync(envLocalPath, 'utf8'), key) !== null;
	const localValue = (key) => readEnvValue(readFileSync(envLocalPath, 'utf8'), key);
	// A generated secret that's actually usable: long enough and not an empty or
	// angle-bracket placeholder (e.g. "<random-32+>") copied in from .env.example.
	const isRealSecret = (v) => !!v && v.length >= 16 && !v.includes('<') && !v.includes('>');
	const convexNames = listConvexEnvNames(projectRoot);
	const convexHas = (key) => convexNames.has(key);
	let rl = createPrompt();

	// A step runs unless (not fresh) and it's already done. With --only, just the
	// matching steps run and the "already configured" check is bypassed for them,
	// so you can redo one step in isolation.
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

	// --- Step 1: app secrets --------------------------------------------------
	await step(
		'App secrets (FUNCTION_SECRET, BETTER_AUTH_SECRET, IP_HASH_SALT)',
		() =>
			isRealSecret(localValue('FUNCTION_SECRET')) &&
			isRealSecret(localValue('IP_HASH_SALT')) &&
			convexHas('BETTER_AUTH_SECRET'),
		() => {
			// Reuse a REAL secret already written locally so re-runs stay stable (the
			// SvelteKit and Convex copies of FUNCTION_SECRET / IP_HASH_SALT must
			// match), but regenerate if the current value is empty or a placeholder
			// (e.g. copied from .env.example) rather than pushing junk to Convex.
			const currentText = readFileSync(envLocalPath, 'utf8');
			const existingFn = readEnvValue(currentText, 'FUNCTION_SECRET');
			const existingSalt = readEnvValue(currentText, 'IP_HASH_SALT');
			const functionSecret = isRealSecret(existingFn) ? existingFn : generateSecret();
			const ipHashSalt = isRealSecret(existingSalt) ? existingSalt : generateSecret();
			const betterAuthSecret = generateSecret();
			upsertEnvLocal(projectRoot, 'FUNCTION_SECRET', functionSecret);
			upsertEnvLocal(projectRoot, 'IP_HASH_SALT', ipHashSalt);
			setConvexEnv(projectRoot, {
				FUNCTION_SECRET: functionSecret,
				IP_HASH_SALT: ipHashSalt,
				BETTER_AUTH_SECRET: betterAuthSecret
			});
			console.log(
				green('  Generated and stored FUNCTION_SECRET, IP_HASH_SALT, BETTER_AUTH_SECRET.')
			);
		}
	);

	// --- Step 2: license signing keypair -------------------------------------
	await step(
		'License signing keypair (Ed25519)',
		() => {
			const kid = readEnvValue(readFileSync(envLocalPath, 'utf8'), 'ED25519_KID');
			return !!kid && localHas('ED25519_PRIVATE_KEY') && desktopKeyHasKid(projectRoot, kid);
		},
		() => {
			describe([
				'Signs the 72h license tokens the desktop app verifies. The private key',
				'goes into .env.local; the public key is written into the desktop app.'
			]);
			const keys = generateLicenseKeypair();
			upsertEnvLocal(projectRoot, 'ED25519_PRIVATE_KEY', keys.privateKeyB64);
			upsertEnvLocal(projectRoot, 'ED25519_KID', keys.kid);
			writeDesktopPublicKey(projectRoot, keys.kid, keys.publicKeyPem);
		}
	);

	// --- Step 3: derived Convex site URL -------------------------------------
	await step(
		'Convex site URL (PUBLIC_CONVEX_SITE_URL)',
		() => localHas('PUBLIC_CONVEX_SITE_URL'),
		() => {
			upsertEnvLocal(projectRoot, 'PUBLIC_CONVEX_SITE_URL', convexSiteUrl);
			console.log(green(`  Set PUBLIC_CONVEX_SITE_URL=${convexSiteUrl}`));
		}
	);

	// --- Step 4: core config --------------------------------------------------
	const siteUrlDefault = 'http://localhost:5173';
	let siteUrl = siteUrlDefault;
	await step(
		'Core config (SITE_URL, LAUNCH_CUTOFF, TRIAL_DAYS)',
		() => convexHas('SITE_URL') && convexHas('LAUNCH_CUTOFF') && convexHas('TRIAL_DAYS'),
		async () => {
			describe([
				'SITE_URL      the web app origin (dev default is fine).',
				'LAUNCH_CUTOFF ISO date the $100 perpetual deal stops being sold. After it,',
				'              only the $12/mo and $120/yr subscriptions are offered.',
				'TRIAL_DAYS    length of the free trial that starts at first activation.'
			]);
			siteUrl = await ask(rl, 'SITE_URL', siteUrlDefault);
			const launchCutoff = await ask(rl, 'LAUNCH_CUTOFF', defaultLaunchCutoff());
			const trialDays = await ask(rl, 'TRIAL_DAYS', '7');
			upsertEnvLocal(projectRoot, 'LAUNCH_CUTOFF', launchCutoff);
			// The homepage pricing reads the launch date client-side, so it also
			// needs the PUBLIC_ copy (kept identical to the server-side value).
			upsertEnvLocal(projectRoot, 'PUBLIC_LAUNCH_CUTOFF', launchCutoff);
			setConvexEnv(projectRoot, {
				SITE_URL: siteUrl,
				LAUNCH_CUTOFF: launchCutoff,
				TRIAL_DAYS: trialDays
			});
			console.log(green('  Stored SITE_URL, LAUNCH_CUTOFF, TRIAL_DAYS.'));
		}
	);

	// --- Step 5: GitHub OAuth -------------------------------------------------
	await step(
		'GitHub sign-in (OAuth app)',
		() => convexHas('GITHUB_CLIENT_ID') && convexHas('GITHUB_CLIENT_SECRET'),
		async () => {
			describe([
				'Create a GitHub OAuth app so users can sign in. On the GitHub page:',
				`  ${bold('Homepage URL')}     ${siteUrl}`,
				`  ${bold('Callback URL')}     ${siteUrl}/api/auth/callback/github`,
				'Then click "Register application", copy the Client ID, and',
				'"Generate a new client secret" and copy that too.'
			]);
			await pressEnterToOpen(
				rl,
				`https://github.com/settings/applications/new?${new URLSearchParams({
					'oauth_app[name]': 'Super Review (dev)',
					'oauth_app[url]': siteUrl,
					'oauth_app[callback_url]': `${siteUrl}/api/auth/callback/github`
				})}`,
				'Create a GitHub OAuth app'
			);
			const clientId = await ask(rl, 'GITHUB_CLIENT_ID');
			const clientSecret = await askSecret(rl, 'GITHUB_CLIENT_SECRET');
			rl = createPrompt();
			if (!clientId || !clientSecret) {
				throw new Error('GitHub auth requires both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
			}
			setConvexEnv(projectRoot, {
				GITHUB_CLIENT_ID: clientId,
				GITHUB_CLIENT_SECRET: clientSecret
			});
			console.log(green('  Stored GitHub OAuth credentials.'));
		}
	);

	// --- Step 6: GitHub releases token ----------------------------------------
	await step(
		'Desktop downloads (GITHUB_RELEASES_TOKEN)',
		() => isRealSecret(localValue('GITHUB_RELEASES_TOKEN')),
		async () => {
			describe([
				'The releases repo is private, so the dashboard download buttons go',
				'through /api/download, which needs a read-only token to look up the',
				'latest release asset. On the GitHub page:',
				'',
				`  ${bold('1)')} Token name        anything, e.g. "Super Review downloads (dev)"`,
				`  ${bold('2)')} Resource owner    ${bold(RELEASES_REPO.split('/')[0])}`,
				`  ${bold('3)')} Expiration        your call; you'll re-run this script to rotate`,
				`  ${bold('4)')} Repository access "Only select repositories" -> ${bold(RELEASES_REPO)}`,
				`  ${bold('5)')} Permissions       expand "Repository permissions", set`,
				`                       ${cyan('Contents')} to ${bold('Read-only')}`,
				'                       (leave everything else at "No access")',
				`  ${bold('6)')} Click "Generate token" and copy it (starts with github_pat_)`,
				'',
				dim('Skip by pressing Enter at the prompt; only downloads break without it.')
			]);
			await pressEnterToOpen(
				rl,
				'https://github.com/settings/personal-access-tokens/new',
				'Create a fine-grained access token'
			);
			const token = await askSecret(rl, 'GITHUB_RELEASES_TOKEN (github_pat_..., or Enter to skip)');
			rl = createPrompt();
			if (!token) {
				console.log(dim('  Skipped. Downloads will return 503 until this is set.'));
				return;
			}
			upsertEnvLocal(projectRoot, 'GITHUB_RELEASES_TOKEN', token);
			console.log(green('  Stored GITHUB_RELEASES_TOKEN.'));
			// Check it against the real endpoint now rather than letting a bad
			// scope surface later as a mystery 502 on a download click.
			await verifyReleasesToken(token);
		}
	);

	// --- Step 7: Stripe -------------------------------------------------------
	await step(
		'Stripe billing (products, prices, webhook)',
		() =>
			convexHas('STRIPE_SECRET_KEY') &&
			convexHas('STRIPE_WEBHOOK_SECRET') &&
			convexHas('STRIPE_PRICE_MONTHLY') &&
			convexHas('STRIPE_PRICE_ANNUAL') &&
			convexHas('STRIPE_PRICE_LIFETIME'),
		async () => {
			const desc = [
				bold('Turn on Test mode in Stripe first (toggle, top-right).'),
				'',
				`${bold('1) Create products & prices')} (Products > Add product):`,
				'   Product "Super Review" with TWO recurring prices:',
				`     ${cyan('•')} $12.00 USD / Monthly   -> STRIPE_PRICE_MONTHLY`,
				`     ${cyan('•')} $120.00 USD / Yearly   -> STRIPE_PRICE_ANNUAL`,
				'   Product "Super Review Perpetual" with ONE one-time price:',
				`     ${cyan('•')} $100.00 USD one-time   -> STRIPE_PRICE_LIFETIME`,
				'   Open each price and copy its API ID (starts with price_...).',
				''
			];
			desc.push(
				`${bold('2) Create the webhook')} (Developers > Webhooks > Add endpoint):`,
				`   Endpoint URL:  ${bold(webhookUrl)}`,
				'   Select exactly these 6 events:',
				`     ${cyan('•')} checkout.session.completed`,
				`     ${cyan('•')} customer.subscription.created`,
				`     ${cyan('•')} customer.subscription.updated`,
				`     ${cyan('•')} customer.subscription.deleted`,
				`     ${cyan('•')} charge.refunded`,
				`     ${cyan('•')} charge.dispute.created`,
				'   After creating it, reveal and copy the Signing secret (whsec_...).',
				dim('   Stripe delivers straight to the Convex deployment, so nothing has to'),
				dim('   be running locally and Stripe retries failed deliveries for 3 days.'),
				''
			);
			desc.push(
				`${bold('3) Activate the customer portal')} (Settings > Billing > Customer portal):`,
				'   Click "Activate test link" and enable "Customers can cancel',
				'   subscriptions" (powers the dashboard\'s Manage billing button).',
				'',
				`${bold('4) Get your API key')} (Developers > API keys):`,
				'   Copy the test Secret key (sk_test_...).'
			);
			describe(desc);

			await pressEnterToOpen(
				rl,
				'https://dashboard.stripe.com/test/products',
				'Open Stripe products'
			);
			await pressEnterToOpen(
				rl,
				'https://dashboard.stripe.com/test/webhooks/create',
				'Open Stripe webhook creation'
			);
			const secretKey = await askSecret(rl, 'STRIPE_SECRET_KEY (sk_test_...)');
			rl = createPrompt();
			const webhookSecret = await askSecret(rl, 'STRIPE_WEBHOOK_SECRET (whsec_...)');
			rl = createPrompt();
			const priceMonthly = await ask(rl, 'STRIPE_PRICE_MONTHLY (price_...)');
			const priceAnnual = await ask(rl, 'STRIPE_PRICE_ANNUAL (price_...)');
			const priceLifetime = await ask(rl, 'STRIPE_PRICE_LIFETIME (price_...)');
			if (!secretKey || !webhookSecret || !priceMonthly || !priceAnnual || !priceLifetime) {
				throw new Error(
					'Stripe setup needs the secret key, webhook secret, and all three price ids.'
				);
			}
			setConvexEnv(projectRoot, {
				STRIPE_SECRET_KEY: secretKey,
				STRIPE_WEBHOOK_SECRET: webhookSecret,
				STRIPE_PRICE_MONTHLY: priceMonthly,
				STRIPE_PRICE_ANNUAL: priceAnnual,
				STRIPE_PRICE_LIFETIME: priceLifetime
			});
			console.log(green('  Stored Stripe keys and price ids.'));
		}
	);

	// --- Step 7b: referral reward coupon --------------------------------------
	await step(
		`Referral reward coupon (${REFERRAL_DISCOUNT_PERCENT}% off)`,
		() => convexHas('STRIPE_REFERRAL_COUPON_ID'),
		async () => {
			describe([
				'Members who get all their guest invites redeemed check out at a',
				`${bold(`${REFERRAL_DISCOUNT_PERCENT}% discount`)}. That discount is a Stripe coupon, applied`,
				'server-side at checkout (no code for the user to type).',
				'',
				`  ${bold('1)')} In Stripe: Product catalogue -> Coupons -> New`,
				`  ${bold('2)')} Percentage discount, ${bold(`${REFERRAL_DISCOUNT_PERCENT}%`)}`,
				`  ${bold('3)')} Duration ${bold('Once')} - it applies to the purchase, not forever`,
				`  ${bold('4)')} Copy the coupon ID (looks like ${dim('AbC12dEf')})`,
				'',
				dim('Keep the percentage in step with REFERRAL_DISCOUNT_PERCENT in'),
				dim('src/lib/convex/invites.ts, which is what the dashboard advertises.'),
				'',
				dim('Skip by pressing Enter: the reward is still recorded and shown, it'),
				dim('just will not actually discount anything at checkout.')
			]);
			await pressEnterToOpen(
				rl,
				'https://dashboard.stripe.com/coupons/create',
				'Open Stripe coupons'
			);
			const couponId = await ask(rl, 'STRIPE_REFERRAL_COUPON_ID (or Enter to skip)');
			if (!couponId) {
				console.log(dim('  Skipped. Earned rewards will not discount checkout until this is set.'));
				return;
			}
			setConvexEnv(projectRoot, { STRIPE_REFERRAL_COUPON_ID: couponId });
			console.log(green('  Stored STRIPE_REFERRAL_COUPON_ID.'));
		}
	);

	// --- Step 8: Loops (waitlist + invite + welcome email) --------------------
	await step(
		'Transactional email (Loops)',
		() => convexHas('LOOPS_API_KEY') && LOOPS_TEMPLATES.every((t) => convexHas(t.envVar)),
		async () => {
			describe([
				'Loops sends the beta emails and holds the waitlist audience. The API',
				'key plus one template id per email, all stored on the Convex',
				'deployment (the sending happens in Convex actions, not SvelteKit).',
				'',
				`  ${bold('1)')} ${cyan('LOOPS_API_KEY')}`,
				'     Create a key on the API settings page (opened below) and copy it.',
				'',
				`  ${bold('2)')} One transactional email per template below. For each:`,
				'     Transactional -> create an email, add the listed data variables to',
				"     its body, publish it, then copy the id from the email's page.",
				'',
				dim('Every prompt is skippable with Enter, and each email is independent:'),
				dim('the ones you configure send, the rest are logged to the Convex'),
				dim('console instead. Fine for local dev.')
			]);
			// Resuming with the key already stored (you skipped some template ids
			// last time) should go straight to them, not make you paste the key again.
			const vars = {};
			if (convexHas('LOOPS_API_KEY') && !fresh) {
				console.log(dim('  LOOPS_API_KEY is already set; leaving it as is.'));
			} else {
				await pressEnterToOpen(rl, LOOPS_API_SETTINGS_URL, 'Open Loops API settings');
				const apiKey = await askSecret(rl, 'LOOPS_API_KEY (or Enter to skip)');
				rl = createPrompt();
				if (!apiKey) {
					console.log(
						dim('  Skipped. All beta emails will be logged to the Convex console instead.')
					);
					return;
				}
				await verifyLoopsKey(apiKey);
				vars.LOOPS_API_KEY = apiKey;
			}

			const missing = [];
			for (const template of LOOPS_TEMPLATES) {
				if (convexHas(template.envVar) && !fresh) {
					console.log(dim(`  ${template.envVar} is already set; leaving it as is.`));
					continue;
				}
				console.log('');
				console.log(`  ${bold(template.label)} ${dim(`- ${template.purpose}`)}`);
				console.log(`  ${dim(`variables: ${template.variables}`)}`);
				const id = await ask(rl, `  ${template.envVar} (or Enter to skip)`);
				if (id) vars[template.envVar] = id;
				else missing.push(template);
			}

			// The key alone is still useful (it makes the audience sync work), so
			// store whatever we got even when no template is ready yet.
			if (Object.keys(vars).length > 0) setConvexEnv(projectRoot, vars);

			// Report only what this run actually wrote: on the resume path values
			// were already there and nothing was stored for them.
			const stored = Object.keys(vars);
			if (stored.length > 0) {
				console.log(green(`\n  Stored ${stored.join(', ')}.`));
			}
			if (missing.length > 0) {
				console.log(
					dim(
						`  Not configured yet: ${missing.map((t) => t.label).join(', ')}. Those emails are\n` +
							'  logged to the Convex console until you re-run this step with their ids.'
					)
				);
			}
		}
	);

	// --- Step 9: in-app feedback webhook --------------------------------------
	await step(
		'In-app feedback notifications (Discord)',
		() => convexHas('FEEDBACK_BOT_TOKEN') && convexHas('FEEDBACK_CHANNEL_ID'),
		async () => {
			describe([
				'Feedback sent from the desktop app is stored in Convex and posted to a',
				'Discord channel so you see it without checking a dashboard. Each report',
				'also gets its own thread, so discussion of one stays attached to it.',
				'',
				'This is a bot rather than a channel webhook: opening a thread on a',
				'message is only possible with a bot token, and once you need a bot for',
				'that it may as well post the message too. One credential, not two.',
				'',
				`  ${bold('1)')} ${cyan('https://discord.com/developers/applications')} -> New Application`,
				`  ${bold('2)')} ${cyan('Bot')} tab -> Reset Token -> copy it (it is shown once)`,
				`  ${bold('3)')} Paste it below. The invite link is built for you from the token,`,
				'     already scoped to the permissions it needs, and opened next.',
				`  ${bold('4)')} In Discord: right-click the target channel -> ${cyan('Copy Channel ID')}`,
				`     (needs ${bold('Settings > Advanced > Developer Mode')} turned on)`,
				'',
				dim('Skippable with Enter. Without both values feedback is still stored in'),
				dim('the `feedback` table, it is just logged to the Convex console.')
			]);
			await pressEnterToOpen(
				rl,
				'https://discord.com/developers/applications',
				'Open the Discord developer portal'
			);
			const botToken = await askSecret(rl, 'FEEDBACK_BOT_TOKEN (or Enter to skip)');
			rl = createPrompt();
			if (!botToken) {
				console.log(dim('  Skipped. Feedback will be logged to the Convex console instead.'));
				return;
			}
			// Check it now rather than letting a mistyped token surface later as
			// feedback that silently never reaches the channel. The id it returns is
			// the application id, so the invite URL needs nothing else from you.
			const appId = await verifyDiscordBot(botToken);
			if (appId) {
				await pressEnterToOpen(
					rl,
					`https://discord.com/api/oauth2/authorize?${new URLSearchParams({
						client_id: appId,
						scope: 'bot',
						permissions: FEEDBACK_BOT_PERMISSIONS
					})}`,
					'Add the bot to your server'
				);
			}

			const channelId = await ask(rl, 'FEEDBACK_CHANNEL_ID (or Enter to skip)');
			if (!channelId) {
				console.log(dim('  Skipped. Feedback will be logged to the Convex console instead.'));
				return;
			}

			setConvexEnv(projectRoot, {
				FEEDBACK_BOT_TOKEN: botToken,
				FEEDBACK_CHANNEL_ID: channelId
			});
			console.log(green('  Stored FEEDBACK_BOT_TOKEN and FEEDBACK_CHANNEL_ID.'));
		}
	);

	rl.close();

	// A typo in --only would otherwise look like a clean run that did nothing.
	if (only && onlyMatched === 0) {
		console.error(`\nNo step title matched "${only}", so nothing ran.`);
		console.error(
			dim('Try one of: secrets, keypair, site url, core config, github, stripe, loops, feedback')
		);
		process.exit(1);
	}

	if (only) {
		console.log(`\n${green(bold(`Done (${onlyMatched} step${onlyMatched === 1 ? '' : 's'}).`))}`);
		return;
	}

	console.log(`\n${green(bold('Setup complete.'))}`);
	console.log('\nNext: start everything with the bizi task runner:');
	console.log(`  ${cyan('bizi')}    ${dim('# runs the dev group: web + desktop')}`);
	console.log('\nOr run them individually:');
	console.log(`  ${cyan('pnpm dev:web')}      ${dim('# Convex + SvelteKit')}`);
	console.log(`  ${cyan(`SUPER_REVIEW_API_URL=${siteUrl} pnpm dev:desktop`)}`);
	console.log(dim('\nStripe webhooks go straight to the Convex deployment, so no local listener.'));
	console.log(
		dim('\nRe-run this script any time; finished steps are skipped. Use --fresh to redo them.')
	);
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
