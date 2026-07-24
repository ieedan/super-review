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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CONVEX_DEV,
	FEEDBACK_BOT_PERMISSIONS,
	LOOPS_API_SETTINGS_URL,
	LOOPS_TEMPLATES,
	REFERRAL_DISCOUNT_PERCENT,
	RELEASES_REPO,
	STRIPE_WEBHOOK_EVENTS,
	ask,
	askSecret,
	bold,
	createPrompt,
	createStepRunner,
	cyan,
	defaultLaunchCutoff,
	describe,
	desktopKeyHasKid,
	dim,
	findProjectRoot,
	generateLicenseKeypair,
	generateSecret,
	green,
	isRealSecret,
	listConvexEnvNames,
	parseSetupArgs,
	pressEnterToOpen,
	readDesktopPublicKeys,
	readEnvValue,
	setConvexEnv,
	upsertEnvLocal,
	verifyDiscordBot,
	verifyLoopsKey,
	verifyReleasesToken,
	writeDesktopPublicKeys
} from './setup-shared.mjs';

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
	// `--fresh`, and `--only stripe` / `--only=stripe`
	const { fresh, only } = parseSetupArgs(args);

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
	const convexNames = listConvexEnvNames(projectRoot, CONVEX_DEV);
	const convexHas = (key) => convexNames.has(key);
	let rl = createPrompt();

	const { step, matched } = createStepRunner({ fresh, only });

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
			// Merge rather than replace: the production key set by `pnpm setup:prod`
			// lives in the same map, and re-running dev setup must not evict it.
			writeDesktopPublicKeys(
				projectRoot,
				{ ...readDesktopPublicKeys(projectRoot), [keys.kid]: keys.publicKeyPem },
				'setup-dev.mjs'
			);
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
				...STRIPE_WEBHOOK_EVENTS.map((e) => `     ${cyan('•')} ${e}`),
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
	const onlyMatched = matched();
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
