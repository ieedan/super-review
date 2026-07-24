// Interactive production setup for the Super Review licensing backend.
//
// The counterpart to setup-dev.mjs. Where that one configures your personal
// Convex dev deployment and .env.local, this one configures the three places a
// real deployment reads from:
//
//   1. the Convex PRODUCTION deployment env      (`convex env set --prod`)
//   2. the Convex PREVIEW default env            (`convex env default --type preview`)
//      - copied into each preview deployment Vercel creates per branch, which
//        is the only way to configure them: they are made on demand and have no
//        stable name to target.
//   3. the VERCEL project env                    (production + preview targets)
//      - everything the SvelteKit server reads, including the license signing
//        key and the Convex deploy keys that let the build push functions.
//
// Follows the convex-app template's DEPLOY.md: a FUNCTION_SECRET shared between
// Vercel and Convex, a Convex deploy key per environment, and a Vercel project
// whose build command is `pnpm vercel:deploy`.
//
// RESUMABLE: each step writes its result to its real destination as soon as it
// finishes, and on the next run a step is skipped when its output already
// exists. Pass --fresh to re-run every step, or --only <text> to redo just the
// steps whose title matches (e.g. `--only stripe`).
//
// Run it from apps/web with `pnpm setup:prod`.
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CONVEX_DEV,
	CONVEX_PREVIEW_DEFAULTS,
	CONVEX_PROD,
	FEEDBACK_BOT_PERMISSIONS,
	LOOPS_API_SETTINGS_URL,
	LOOPS_TEMPLATES,
	REFERRAL_DISCOUNT_PERCENT,
	RELEASES_REPO,
	STRIPE_WEBHOOK_EVENTS,
	ask,
	askSecret,
	askYesNo,
	bold,
	convexDeploymentName,
	createPrompt,
	createStepRunner,
	cyan,
	defaultLaunchCutoff,
	describe,
	dim,
	findProjectRoot,
	generateLicenseKeypair,
	generateSecret,
	getConvexEnv,
	green,
	heading,
	isRealSecret,
	listConvexEnvNames,
	parseSetupArgs,
	pressEnterToOpen,
	readDesktopPublicKeys,
	readEnvValue,
	setConvexEnv,
	verifyDiscordBot,
	verifyLoopsKey,
	verifyReleasesToken,
	verifyStripeKey,
	writeDesktopPublicKeys,
	yellow
} from './setup-shared.mjs';

// The production origin. The desktop app hard-codes this as DEFAULT_WEB_BASE
// (apps/desktop/src/main/license/service.ts) and license tokens are issued with
// it as their issuer (src/lib/server/license-token.ts), so changing it here
// means changing it there too.
const PRODUCTION_SITE_URL = 'https://superreview.dev';

// The long-lived branch PRs merge into. `main` is the release branch (the
// Release workflow triggers on a push to it), so `dev` is what day to day work
// lands on, and its Vercel branch alias is the one stable preview origin worth
// pointing sign-in and Stripe redirects at.
const INTEGRATION_BRANCH = 'dev';

// Vercel project settings the build depends on. This is a pnpm monorepo, so the
// project's Root Directory has to be apps/web AND "Include files outside of the
// Root Directory" has to be on, otherwise the workspace deps (@super-review/ui,
// @super-review/core) are not there to install.
const VERCEL_SETTINGS = [
	['Root Directory', 'apps/web'],
	['Include files outside root', 'enabled (needed for the pnpm workspace deps)'],
	['Framework Preset', 'SvelteKit'],
	['Build Command', 'pnpm vercel:deploy'],
	['Install Command', 'pnpm install'],
	['Node.js Version', '24.x']
];

// --- vercel cli ---------------------------------------------------------------

function vercelInstalled() {
	try {
		execSync('vercel --version', { stdio: ['ignore', 'ignore', 'ignore'] });
		return true;
	} catch {
		return false;
	}
}

function vercelLinked(projectRoot) {
	return existsSync(join(projectRoot, '.vercel', 'project.json'));
}

// Names of the variables already on the Vercel project for a target. Only used
// as a resume hint, so a parse miss just means a step re-runs; pushes go out
// with --force and are idempotent either way.
function vercelEnvNames(projectRoot, target) {
	try {
		const out = execSync(`vercel env ls ${target}`, {
			cwd: projectRoot,
			stdio: ['ignore', 'pipe', 'ignore']
		}).toString();
		return new Set([...out.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s{2,}/gm)].map((m) => m[1]));
	} catch {
		return new Set();
	}
}

// Adds one variable to the Vercel project, overwriting any existing value for
// that target. The value goes in over stdin so it never reaches the shell
// history or the process list.
function vercelEnvSet(projectRoot, name, value, target, { sensitive = false } = {}) {
	execSync(`vercel env add ${name} ${target} --force${sensitive ? ' --sensitive' : ''}`, {
		cwd: projectRoot,
		input: `${value}\n`,
		stdio: ['pipe', 'ignore', 'pipe'],
		timeout: 120_000
	});
}

// Variables that must never be readable again once stored. `--sensitive` means
// Vercel will not show or export the value, only overwrite it.
const SENSITIVE_VERCEL_VARS = new Set([
	'CONVEX_DEPLOY_KEY',
	'FUNCTION_SECRET',
	'IP_HASH_SALT',
	'ED25519_PRIVATE_KEY',
	'GITHUB_RELEASES_TOKEN'
]);

function writeEnvFile(path, variables) {
	const body = Object.entries(variables)
		.filter(([, v]) => v !== undefined && v !== '')
		.map(([k, v]) => `${k}="${v}"`)
		.join('\n');
	writeFileSync(path, `${body}\n`, { mode: 0o600 });
}

// The generated .env.vercel.* files hold live secrets, so make sure git is
// ignoring them before they are written rather than after.
function ensureGitignored(repoRoot, pattern) {
	const gitignorePath = join(repoRoot, '.gitignore');
	if (!existsSync(gitignorePath)) return;
	const contents = readFileSync(gitignorePath, 'utf8');
	if (contents.split('\n').some((line) => line.trim() === pattern)) return;
	appendFileSync(gitignorePath, `${contents.endsWith('\n') ? '' : '\n'}${pattern}\n`);
	console.log(dim(`  Added "${pattern}" to .gitignore.`));
}

// --- main ---------------------------------------------------------------------

async function main() {
	const args = process.argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) {
		console.log(`Super Review licensing production setup

Usage: pnpm setup:prod [--fresh] [--only <text>] [--skip-preview]

Configures the Convex production deployment, the Convex preview defaults, and
the Vercel project environment, then prints the deploy and post-deploy steps.

Resumable by default: re-running skips steps whose output already exists.

  --fresh, --no-resume   Re-run every step and overwrite existing values.
                         NOTE: this regenerates the production license signing
                         keypair, invalidating every license token already
                         issued. Prefer --only.
  --only <text>          Run only the steps whose title contains <text>, e.g.
                         \`--only stripe\`.
  --skip-preview         Configure production only; leave the Convex preview
                         defaults and the Vercel preview env alone.
  --help, -h             Show this help.

Prerequisite: a Convex project (\`pnpm setup:dev\` or \`pnpm convex dev --once\`),
and the Vercel CLI logged in (\`vercel login\`).`);
		return;
	}

	const { fresh, only } = parseSetupArgs(args);
	const skipPreview = args.includes('--skip-preview');

	const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
	const repoRoot = resolve(projectRoot, '../..');
	const envLocalPath = join(projectRoot, '.env.local');

	console.log(bold('Super Review licensing production setup'));
	if (only) console.log(dim(`(--only ${only}: running just the matching steps)`));
	else if (fresh) console.log(dim('(--fresh: re-running every step)'));
	else console.log(dim('(resumable: finished steps are skipped; pass --fresh to redo them)'));
	if (skipPreview) console.log(dim('(--skip-preview: production only)'));

	// The Convex CLI resolves `--prod` through the project recorded in
	// .env.local's CONVEX_DEPLOYMENT, so a dev setup has to have happened first.
	if (!existsSync(envLocalPath)) {
		console.error(
			'\nNo .env.local found, so there is no Convex project to find the production\n' +
				'deployment of. Run `pnpm setup:dev` (or `pnpm convex dev --once`) first.'
		);
		process.exit(1);
	}

	const deploymentName = convexDeploymentName(projectRoot, CONVEX_PROD);
	if (!deploymentName) {
		console.error(
			"\nCould not resolve this project's production deployment. Check that you are\n" +
				'logged in (`pnpm convex login`) and that .env.local has a CONVEX_DEPLOYMENT.'
		);
		process.exit(1);
	}
	const prodConvexUrl = `https://${deploymentName}.convex.cloud`;
	const prodConvexSiteUrl = `https://${deploymentName}.convex.site`;
	const webhookUrl = `${prodConvexSiteUrl}/api/auth/stripe/webhook`;
	console.log(dim(`\nProduction Convex deployment: ${deploymentName}`));
	console.log(dim(`  ${prodConvexUrl}`));

	const prodNames = listConvexEnvNames(projectRoot, CONVEX_PROD);
	const previewNames = listConvexEnvNames(projectRoot, CONVEX_PREVIEW_DEFAULTS);
	const prodHas = (key) => prodNames.has(key);
	const previewHas = (key) => skipPreview || previewNames.has(key);

	const hasVercel = vercelInstalled();
	// Re-read after step 1, which is where linking happens: what is already on
	// the project is how the later steps tell whether they have run before.
	let linked = hasVercel && vercelLinked(projectRoot);
	let vercelProdNames = linked ? vercelEnvNames(projectRoot, 'production') : new Set();
	const vercelHas = (key) => vercelProdNames.has(key);
	const refreshVercelState = () => {
		linked = hasVercel && vercelLinked(projectRoot);
		vercelProdNames = linked ? vercelEnvNames(projectRoot, 'production') : new Set();
	};

	// Everything bound for the Vercel project, collected as the steps run and
	// pushed in one go at the end. Collecting first means a half-finished run
	// never leaves the project with a FUNCTION_SECRET that doesn't match Convex.
	const vercelEnv = { production: {}, preview: {} };
	const forProduction = (vars) => Object.assign(vercelEnv.production, vars);
	const forPreview = (vars) => {
		if (!skipPreview) Object.assign(vercelEnv.preview, vars);
	};

	// Values already configured for dev, offered as defaults for the ones that
	// are genuinely the same in both (Loops templates, the Discord channel, the
	// releases token). Read lazily so an unreachable dev deployment is not fatal.
	const devLocal = (key) => readEnvValue(readFileSync(envLocalPath, 'utf8'), key);
	const devConvex = (key) => getConvexEnv(projectRoot, key, CONVEX_DEV);

	let rl = createPrompt();
	const { step, matched } = createStepRunner({ fresh, only });

	// --- Step 1: Vercel project ------------------------------------------------
	await step(
		'Vercel project (link and settings)',
		() => linked,
		async () => {
			describe([
				'The site deploys to Vercel, and the Vercel build is what pushes the',
				'Convex functions (that is what `pnpm vercel:deploy` does: `convex deploy`',
				'with `--cmd` wrapping the Vite build).',
				'',
				`Create the project at ${cyan('https://vercel.com/new')} from this repo, then set:`,
				'',
				...VERCEL_SETTINGS.map(([label, value]) => `  ${bold(label.padEnd(28))} ${value}`),
				'',
				dim('Root Directory + "include files outside" are the two that bite: this is a'),
				dim('pnpm workspace and apps/web depends on @super-review/ui and'),
				dim('@super-review/core, which live outside apps/web.')
			]);
			if (!hasVercel) {
				console.log(
					yellow('  The Vercel CLI is not installed, so environment variables cannot be\n') +
						yellow('  pushed for you. Install it with `pnpm add -g vercel`, or this script\n') +
						yellow('  will write .env files you can import from the dashboard instead.')
				);
				return;
			}
			await pressEnterToOpen(rl, 'https://vercel.com/new', 'Open Vercel');
			if (await askYesNo(rl, 'Link this directory to the Vercel project now?', true)) {
				try {
					execSync('vercel link', { cwd: projectRoot, stdio: 'inherit' });
				} catch {
					console.log(dim('  Linking did not complete; you can re-run `vercel link` later.'));
				}
				refreshVercelState();
			}
		}
	);

	// --- Step 2: vercel.json ---------------------------------------------------
	await step(
		'Build configuration (vercel.json)',
		() => existsSync(join(projectRoot, 'vercel.json')),
		async () => {
			describe([
				'Committing the build and install commands means a project recreated',
				'later builds the same way without anyone remembering the dashboard',
				'settings. Mirrors the convex-app template.'
			]);
			if (!(await askYesNo(rl, 'Write apps/web/vercel.json?', true))) {
				console.log(dim('  Skipped. Set the commands in the Vercel dashboard instead.'));
				return;
			}
			writeFileSync(
				join(projectRoot, 'vercel.json'),
				`${JSON.stringify(
					{
						$schema: 'https://openapi.vercel.sh/vercel.json',
						buildCommand: 'pnpm vercel:deploy',
						installCommand: 'pnpm install'
					},
					null,
					'\t'
				)}\n`
			);
			console.log(green('  Wrote apps/web/vercel.json.'));
		}
	);

	// --- Step 3: Convex deploy keys --------------------------------------------
	await step(
		'Convex deploy keys (production and preview)',
		() => vercelHas('CONVEX_DEPLOY_KEY'),
		async () => {
			describe([
				'A deploy key is what lets the Vercel build push functions to Convex.',
				'Two different kinds:',
				'',
				`  ${bold('Production key')}  deploys to ${deploymentName}. Generate it under`,
				'                  Settings > URL & Deploy Key > Generate production deploy key.',
				`  ${bold('Preview key')}     creates a fresh preview deployment per branch, seeded`,
				'                  from the preview default env vars this script sets.',
				'                  Same page, "Generate preview deploy key".',
				'',
				dim('The preview key is optional: without it, preview builds have nowhere to'),
				dim('push and will fail, so leave it blank if you only want production.')
			]);
			await pressEnterToOpen(
				rl,
				`https://dashboard.convex.dev/d/${deploymentName}/settings`,
				'Open the Convex deployment settings'
			);
			const prodKey = await askSecret(rl, 'CONVEX_DEPLOY_KEY (production, prod:...)');
			rl = createPrompt();
			if (!prodKey) throw new Error('A production deploy key is required to deploy.');
			if (!prodKey.startsWith('prod:')) {
				console.log(
					yellow('  Warning: a production deploy key normally starts with "prod:".') +
						dim(' Continuing anyway.')
				);
			}
			forProduction({ CONVEX_DEPLOY_KEY: prodKey });

			if (skipPreview) return;
			const previewKey = await askSecret(
				rl,
				'CONVEX_DEPLOY_KEY (preview, preview:... or Enter to skip)'
			);
			rl = createPrompt();
			if (!previewKey) {
				console.log(dim('  Skipped. Preview builds will fail until a preview key is set.'));
				return;
			}
			forPreview({ CONVEX_DEPLOY_KEY: previewKey });
			console.log(green('  Collected both deploy keys.'));
		}
	);

	// --- Step 4: app secrets ----------------------------------------------------
	await step(
		'App secrets (FUNCTION_SECRET, BETTER_AUTH_SECRET, IP_HASH_SALT)',
		() =>
			prodHas('FUNCTION_SECRET') &&
			prodHas('BETTER_AUTH_SECRET') &&
			prodHas('IP_HASH_SALT') &&
			vercelHas('FUNCTION_SECRET') &&
			previewHas('FUNCTION_SECRET'),
		() => {
			describe([
				'FUNCTION_SECRET authorizes SvelteKit -> Convex internal calls, so the',
				'Vercel copy and the Convex copy must be identical. IP_HASH_SALT is',
				'likewise read on both sides and has to match or the hashes will not',
				'line up. BETTER_AUTH_SECRET is Convex-only.',
				'',
				dim('Production and preview get separate secrets on purpose: a value leaked'),
				dim('from a preview deployment then unlocks nothing in production.')
			]);
			// Reuse whatever production already has so a re-run cannot desynchronise
			// the two halves; only generate what is genuinely missing.
			const functionSecret = getConvexEnv(projectRoot, 'FUNCTION_SECRET', CONVEX_PROD);
			const ipHashSalt = getConvexEnv(projectRoot, 'IP_HASH_SALT', CONVEX_PROD);
			const prodSecrets = {
				FUNCTION_SECRET: isRealSecret(functionSecret) && !fresh ? functionSecret : generateSecret(),
				IP_HASH_SALT: isRealSecret(ipHashSalt) && !fresh ? ipHashSalt : generateSecret(),
				BETTER_AUTH_SECRET: generateSecret()
			};
			setConvexEnv(projectRoot, prodSecrets, CONVEX_PROD);
			forProduction({
				FUNCTION_SECRET: prodSecrets.FUNCTION_SECRET,
				IP_HASH_SALT: prodSecrets.IP_HASH_SALT
			});
			console.log(green('  Stored the production secrets.'));

			if (skipPreview) return;
			const previewFunctionSecret = getConvexEnv(
				projectRoot,
				'FUNCTION_SECRET',
				CONVEX_PREVIEW_DEFAULTS
			);
			const previewIpHashSalt = getConvexEnv(projectRoot, 'IP_HASH_SALT', CONVEX_PREVIEW_DEFAULTS);
			const previewSecrets = {
				FUNCTION_SECRET:
					isRealSecret(previewFunctionSecret) && !fresh ? previewFunctionSecret : generateSecret(),
				IP_HASH_SALT:
					isRealSecret(previewIpHashSalt) && !fresh ? previewIpHashSalt : generateSecret(),
				BETTER_AUTH_SECRET: generateSecret()
			};
			setConvexEnv(projectRoot, previewSecrets, CONVEX_PREVIEW_DEFAULTS);
			forPreview({
				FUNCTION_SECRET: previewSecrets.FUNCTION_SECRET,
				IP_HASH_SALT: previewSecrets.IP_HASH_SALT
			});
			console.log(green('  Stored the preview secrets.'));
		}
	);

	// --- Step 5: license signing keypair ---------------------------------------
	await step(
		'License signing keypair (Ed25519, production)',
		() => vercelHas('ED25519_KID'),
		async () => {
			describe([
				'The private half signs the 72h license tokens; the public half is',
				'compiled into the desktop app, keyed by its kid. Production needs its',
				'OWN pair: the dev private key sits in a developer .env.local, and a',
				'shipped binary should not trust anything signed with it.',
				'',
				`${bold(yellow('Generating a new pair invalidates every token already issued.'))}`,
				dim('Clients re-request one on next launch, so the cost is a forced'),
				dim('revalidation rather than a lockout - but only do it deliberately.')
			]);

			// Without a linked Vercel project there is no way to see whether a
			// production key already exists, so ask rather than silently rotating.
			if (!linked) {
				const existingKid = await ask(
					rl,
					'Existing production ED25519_KID (Enter to generate a new keypair)'
				);
				if (existingKid) {
					console.log(dim(`  Keeping ${existingKid}; leaving the Vercel value alone.`));
					return;
				}
			} else if (!fresh && vercelHas('ED25519_KID')) {
				// --only keypair is the deliberate way to rotate, so confirm rather
				// than refuse; anything else leaves a working key alone.
				if (!only) {
					console.log(dim('  A production keypair is already on Vercel; leaving it alone.'));
					return;
				}
				if (!(await askYesNo(rl, '  Rotate it? Tokens already issued stop verifying.', false))) {
					console.log(dim('  Left alone.'));
					return;
				}
			}

			const keys = generateLicenseKeypair();
			forProduction({
				ED25519_PRIVATE_KEY: keys.privateKeyB64,
				ED25519_KID: keys.kid
			});

			const existing = readDesktopPublicKeys(projectRoot);
			const otherKids = Object.keys(existing).filter((kid) => kid !== keys.kid);
			let keep = true;
			if (otherKids.length > 0) {
				console.log('');
				console.log(
					`  The desktop app currently embeds: ${otherKids.join(', ')} ${dim('(dev keys)')}`
				);
				console.log(
					dim('  Keeping them lets a local build verify tokens from a dev deployment.') +
						dim('\n  Dropping them means a shipped build trusts production only.')
				);
				keep = await askYesNo(rl, '  Keep the existing keys alongside the production one?', true);
			}
			writeDesktopPublicKeys(
				projectRoot,
				keep ? { ...existing, [keys.kid]: keys.publicKeyPem } : { [keys.kid]: keys.publicKeyPem },
				'setup-prod.mjs'
			);
			console.log(
				dim('  Commit apps/desktop/src/main/license/public-key.ts and cut a desktop\n') +
					dim('  release before activating against production, or the app will reject\n') +
					dim('  tokens signed with this key.')
			);

			if (skipPreview) return;
			// Previews reuse the DEV keypair rather than getting one of their own:
			// the desktop app already embeds that public key, so a local build can
			// activate against a preview deployment with no extra key shipped to
			// production.
			const devKey = devLocal('ED25519_PRIVATE_KEY');
			const devKid = devLocal('ED25519_KID');
			if (devKey && devKid) {
				forPreview({ ED25519_PRIVATE_KEY: devKey, ED25519_KID: devKid });
				console.log(dim(`  Previews will sign with the dev key (${devKid}).`));
			} else {
				console.log(
					dim('  No dev keypair in .env.local, so previews get no signing key. Run\n') +
						dim('  `pnpm setup:dev --only keypair` if you want to activate against one.')
				);
			}
		}
	);

	// --- Step 6: core config ----------------------------------------------------
	let siteUrl = PRODUCTION_SITE_URL;
	await step(
		'Core config (SITE_URL, LAUNCH_CUTOFF, TRIAL_DAYS)',
		() =>
			prodHas('SITE_URL') &&
			prodHas('LAUNCH_CUTOFF') &&
			prodHas('TRIAL_DAYS') &&
			vercelHas('LAUNCH_CUTOFF'),
		async () => {
			describe([
				'SITE_URL      the public origin. better-auth uses it as its baseURL, so',
				'              it has to match the domain users actually arrive on,',
				'              exactly, including the scheme and no trailing slash.',
				'LAUNCH_CUTOFF ISO date the $100 perpetual deal stops being sold.',
				'TRIAL_DAYS    length of the free trial that starts at first activation.'
			]);
			siteUrl = await ask(rl, 'SITE_URL', PRODUCTION_SITE_URL);
			const launchCutoff = await ask(
				rl,
				'LAUNCH_CUTOFF',
				getConvexEnv(projectRoot, 'LAUNCH_CUTOFF', CONVEX_PROD) ??
					devLocal('LAUNCH_CUTOFF') ??
					defaultLaunchCutoff()
			);
			const trialDays = await ask(rl, 'TRIAL_DAYS', '7');
			setConvexEnv(
				projectRoot,
				{ SITE_URL: siteUrl, LAUNCH_CUTOFF: launchCutoff, TRIAL_DAYS: trialDays },
				CONVEX_PROD
			);
			// The homepage pricing reads the launch date client-side, so the build
			// also needs the PUBLIC_ copy (kept identical to the server-side value).
			forProduction({ LAUNCH_CUTOFF: launchCutoff, PUBLIC_LAUNCH_CUTOFF: launchCutoff });
			console.log(green('  Stored the production core config.'));

			if (skipPreview) return;
			describe([
				'',
				'Preview deployments get a different URL per commit, and better-auth needs',
				`one fixed origin, so the preview SITE_URL is the ${bold(INTEGRATION_BRANCH)} branch's`,
				'stable Vercel alias:',
				dim(`  https://<project>-git-${INTEGRATION_BRANCH}-<team>.vercel.app`),
				'',
				`That is why PRs target ${bold(INTEGRATION_BRANCH)} rather than ${bold('main')}: one long-lived branch`,
				'means one long-lived preview origin, which is the only kind sign-in and',
				'Stripe redirects can actually be pointed at. Per-commit preview URLs',
				'still build, they just will not complete an OAuth round trip.',
				'',
				dim('Skippable: without it, previews have no SITE_URL and sign-in there is'),
				dim('unconfigured until you set one by hand on the deployment.')
			]);
			const previewSiteUrl = await ask(rl, 'Preview SITE_URL (or Enter to skip)');
			setConvexEnv(
				projectRoot,
				{
					...(previewSiteUrl ? { SITE_URL: previewSiteUrl } : {}),
					LAUNCH_CUTOFF: launchCutoff,
					TRIAL_DAYS: trialDays
				},
				CONVEX_PREVIEW_DEFAULTS
			);
			forPreview({ LAUNCH_CUTOFF: launchCutoff, PUBLIC_LAUNCH_CUTOFF: launchCutoff });
			console.log(green('  Stored the preview core config.'));
		}
	);

	// --- Step 7: GitHub OAuth ---------------------------------------------------
	await step(
		'GitHub sign-in (production OAuth app)',
		() => prodHas('GITHUB_CLIENT_ID') && prodHas('GITHUB_CLIENT_SECRET'),
		async () => {
			describe([
				'Production needs its own OAuth app: an app has exactly one callback URL,',
				'and the dev one points at localhost. On the GitHub page:',
				`  ${bold('Homepage URL')}     ${siteUrl}`,
				`  ${bold('Callback URL')}     ${siteUrl}/api/auth/callback/github`,
				'Then "Register application", copy the Client ID, and "Generate a new',
				'client secret" and copy that too.',
				'',
				dim('If you change SITE_URL later, change the callback URL to match or'),
				dim('sign-in breaks with a redirect_uri mismatch.')
			]);
			await pressEnterToOpen(
				rl,
				`https://github.com/settings/applications/new?${new URLSearchParams({
					'oauth_app[name]': 'Super Review',
					'oauth_app[url]': siteUrl,
					'oauth_app[callback_url]': `${siteUrl}/api/auth/callback/github`
				})}`,
				'Create the production GitHub OAuth app'
			);
			const clientId = await ask(rl, 'GITHUB_CLIENT_ID');
			const clientSecret = await askSecret(rl, 'GITHUB_CLIENT_SECRET');
			rl = createPrompt();
			if (!clientId || !clientSecret) {
				throw new Error('GitHub auth requires both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
			}
			setConvexEnv(
				projectRoot,
				{ GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret },
				CONVEX_PROD
			);
			console.log(green('  Stored the production GitHub OAuth credentials.'));

			if (skipPreview) return;
			console.log('');
			if (!(await askYesNo(rl, '  Configure a separate OAuth app for previews?', false))) {
				console.log(dim('  Skipped. Sign-in on previews stays unconfigured.'));
				return;
			}
			const previewClientId = await ask(rl, '  GITHUB_CLIENT_ID (preview)');
			const previewClientSecret = await askSecret(rl, '  GITHUB_CLIENT_SECRET (preview)');
			rl = createPrompt();
			if (previewClientId && previewClientSecret) {
				setConvexEnv(
					projectRoot,
					{ GITHUB_CLIENT_ID: previewClientId, GITHUB_CLIENT_SECRET: previewClientSecret },
					CONVEX_PREVIEW_DEFAULTS
				);
				console.log(green('  Stored the preview GitHub OAuth credentials.'));
			}
		}
	);

	// --- Step 8: GitHub releases token ------------------------------------------
	await step(
		'Desktop downloads (GITHUB_RELEASES_TOKEN)',
		() => vercelHas('GITHUB_RELEASES_TOKEN'),
		async () => {
			describe([
				`${RELEASES_REPO} is private, so /api/download and the update proxy need a`,
				'read-only token to resolve release assets. On the GitHub page:',
				'',
				`  ${bold('1)')} Token name        e.g. "Super Review downloads (production)"`,
				`  ${bold('2)')} Resource owner    ${bold(RELEASES_REPO.split('/')[0])}`,
				`  ${bold('3)')} Expiration        production tokens expire; put a reminder in`,
				'                       your calendar, downloads break the day it lapses',
				`  ${bold('4)')} Repository access "Only select repositories" -> ${bold(RELEASES_REPO)}`,
				`  ${bold('5)')} Permissions       ${cyan('Contents')} -> ${bold('Read-only')}`,
				`  ${bold('6)')} Generate token and copy it (starts with github_pat_)`,
				'',
				dim('The dev token works here too if it is scoped to the same repo; press'),
				dim('Enter to reuse it.')
			]);
			await pressEnterToOpen(
				rl,
				'https://github.com/settings/personal-access-tokens/new',
				'Create a fine-grained access token'
			);
			const devToken = devLocal('GITHUB_RELEASES_TOKEN');
			const token =
				(await askSecret(
					rl,
					`GITHUB_RELEASES_TOKEN (github_pat_..., Enter to ${devToken ? 'reuse the dev token' : 'skip'})`
				)) || devToken;
			rl = createPrompt();
			if (!token) {
				console.log(dim('  Skipped. Downloads return 503 until this is set.'));
				return;
			}
			await verifyReleasesToken(token);
			forProduction({ GITHUB_RELEASES_TOKEN: token });
			forPreview({ GITHUB_RELEASES_TOKEN: token });
			console.log(green('  Collected GITHUB_RELEASES_TOKEN.'));
		}
	);

	// --- Step 9: Stripe ---------------------------------------------------------
	await step(
		'Stripe billing (live products, prices, webhook)',
		() =>
			prodHas('STRIPE_SECRET_KEY') &&
			prodHas('STRIPE_WEBHOOK_SECRET') &&
			prodHas('STRIPE_PRICE_MONTHLY') &&
			prodHas('STRIPE_PRICE_ANNUAL') &&
			prodHas('STRIPE_PRICE_LIFETIME'),
		async () => {
			describe([
				bold(yellow('Turn OFF Test mode in Stripe first (toggle, top-right).')),
				dim('Test-mode ids and keys are a different namespace; mixing them shows up'),
				dim('as "No such price" at checkout.'),
				'',
				`${bold('1) Create products & prices')} (Products > Add product):`,
				'   Product "Super Review" with TWO recurring prices:',
				`     ${cyan('•')} $12.00 USD / Monthly   -> STRIPE_PRICE_MONTHLY`,
				`     ${cyan('•')} $120.00 USD / Yearly   -> STRIPE_PRICE_ANNUAL`,
				'   Product "Super Review Perpetual" with ONE one-time price:',
				`     ${cyan('•')} $100.00 USD one-time   -> STRIPE_PRICE_LIFETIME`,
				'   Open each price and copy its API ID (starts with price_...).',
				'',
				`${bold('2) Create the webhook')} (Developers > Webhooks > Add endpoint):`,
				`   Endpoint URL:  ${bold(webhookUrl)}`,
				'   Select exactly these 6 events:',
				...STRIPE_WEBHOOK_EVENTS.map((e) => `     ${cyan('•')} ${e}`),
				'   Then reveal and copy the Signing secret (whsec_...).',
				dim('   Stripe delivers straight to the Convex deployment, so the webhook'),
				dim('   keeps working even while Vercel is mid-deploy.'),
				'',
				`${bold('3) Activate the customer portal')} (Settings > Billing > Customer portal):`,
				'   Enable "Customers can cancel subscriptions" (powers the dashboard\'s',
				'   Manage billing button).',
				'',
				`${bold('4) Get your API key')} (Developers > API keys):`,
				'   Copy the LIVE Secret key (sk_live_...).'
			]);

			await pressEnterToOpen(rl, 'https://dashboard.stripe.com/products', 'Open Stripe products');
			await pressEnterToOpen(
				rl,
				'https://dashboard.stripe.com/webhooks/create',
				'Open Stripe webhook creation'
			);
			const secretKey = await askSecret(rl, 'STRIPE_SECRET_KEY (sk_live_...)');
			rl = createPrompt();
			const mode = secretKey ? await verifyStripeKey(secretKey) : null;
			if (mode === 'test') {
				console.log(
					yellow('  That is a TEST key. Production checkout will not charge anyone with it.')
				);
				if (!(await askYesNo(rl, '  Store it anyway?', false))) {
					throw new Error('Stopped: re-run with a live Stripe key.');
				}
			}
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
			setConvexEnv(
				projectRoot,
				{
					STRIPE_SECRET_KEY: secretKey,
					STRIPE_WEBHOOK_SECRET: webhookSecret,
					STRIPE_PRICE_MONTHLY: priceMonthly,
					STRIPE_PRICE_ANNUAL: priceAnnual,
					STRIPE_PRICE_LIFETIME: priceLifetime
				},
				CONVEX_PROD
			);
			console.log(green('  Stored the live Stripe keys and price ids.'));

			if (skipPreview) return;
			// Previews stay on the dev deployment's TEST-mode Stripe config: a
			// branch build should never be able to take real money, and the test
			// webhook already points somewhere harmless.
			const testConfig = {
				STRIPE_SECRET_KEY: devConvex('STRIPE_SECRET_KEY'),
				STRIPE_WEBHOOK_SECRET: devConvex('STRIPE_WEBHOOK_SECRET'),
				STRIPE_PRICE_MONTHLY: devConvex('STRIPE_PRICE_MONTHLY'),
				STRIPE_PRICE_ANNUAL: devConvex('STRIPE_PRICE_ANNUAL'),
				STRIPE_PRICE_LIFETIME: devConvex('STRIPE_PRICE_LIFETIME')
			};
			if (Object.values(testConfig).every(Boolean)) {
				setConvexEnv(projectRoot, testConfig, CONVEX_PREVIEW_DEFAULTS);
				console.log(green("  Previews will use the dev deployment's test-mode Stripe config."));
			} else {
				console.log(dim('  No test-mode Stripe config on the dev deployment; previews get none.'));
			}
		}
	);

	// --- Step 9b: referral reward coupon ----------------------------------------
	await step(
		`Referral reward coupon (${REFERRAL_DISCOUNT_PERCENT}% off, live)`,
		() => prodHas('STRIPE_REFERRAL_COUPON_ID'),
		async () => {
			describe([
				'Members who get all their guest invites redeemed check out at a',
				`${bold(`${REFERRAL_DISCOUNT_PERCENT}% discount`)}, applied server-side (no code for the user to type).`,
				'Coupons are per-mode, so the live account needs its own.',
				'',
				`  ${bold('1)')} Stripe (live mode): Product catalogue -> Coupons -> New`,
				`  ${bold('2)')} Percentage discount, ${bold(`${REFERRAL_DISCOUNT_PERCENT}%`)}`,
				`  ${bold('3)')} Duration ${bold('Once')} - it applies to the purchase, not forever`,
				`  ${bold('4)')} Copy the coupon ID (looks like ${dim('AbC12dEf')})`,
				'',
				dim('Keep the percentage in step with REFERRAL_DISCOUNT_PERCENT in'),
				dim('src/lib/convex/invites.ts, which is what the dashboard advertises.'),
				dim('Skippable: the reward is still recorded and shown, it just will not'),
				dim('discount anything.')
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
			setConvexEnv(projectRoot, { STRIPE_REFERRAL_COUPON_ID: couponId }, CONVEX_PROD);
			console.log(green('  Stored STRIPE_REFERRAL_COUPON_ID.'));
		}
	);

	// --- Step 10: Loops ----------------------------------------------------------
	await step(
		'Transactional email (Loops)',
		() => prodHas('LOOPS_API_KEY') && LOOPS_TEMPLATES.every((t) => prodHas(t.envVar)),
		async () => {
			describe([
				'Loops sends the beta emails and holds the waitlist audience. Unlike',
				'Stripe there is no test/live split: the same account, key, and',
				'published templates serve every environment, so the dev values are',
				'almost always the right answer here.',
				'',
				dim('Every prompt is skippable with Enter; an unset template id means that'),
				dim('one email is logged to the Convex console instead of sent.')
			]);

			const vars = {};
			if (prodHas('LOOPS_API_KEY') && !fresh) {
				console.log(dim('  LOOPS_API_KEY is already set on production; leaving it as is.'));
			} else {
				const devApiKey = devConvex('LOOPS_API_KEY');
				await pressEnterToOpen(rl, LOOPS_API_SETTINGS_URL, 'Open Loops API settings');
				const apiKey =
					(await askSecret(
						rl,
						`LOOPS_API_KEY (Enter to ${devApiKey ? 'reuse the dev key' : 'skip'})`
					)) || devApiKey;
				rl = createPrompt();
				if (!apiKey) {
					console.log(dim('  Skipped. All beta emails will be logged to the Convex console.'));
					return;
				}
				await verifyLoopsKey(apiKey);
				vars.LOOPS_API_KEY = apiKey;
			}

			const missing = [];
			for (const template of LOOPS_TEMPLATES) {
				if (prodHas(template.envVar) && !fresh) {
					console.log(dim(`  ${template.envVar} is already set; leaving it as is.`));
					continue;
				}
				console.log('');
				console.log(`  ${bold(template.label)} ${dim(`- ${template.purpose}`)}`);
				console.log(`  ${dim(`variables: ${template.variables}`)}`);
				const id = await ask(
					rl,
					`  ${template.envVar} (or Enter to skip)`,
					devConvex(template.envVar) ?? undefined
				);
				if (id) vars[template.envVar] = id;
				else missing.push(template);
			}

			if (Object.keys(vars).length > 0) {
				setConvexEnv(projectRoot, vars, CONVEX_PROD);
				if (!skipPreview) setConvexEnv(projectRoot, vars, CONVEX_PREVIEW_DEFAULTS);
				console.log(green(`\n  Stored ${Object.keys(vars).join(', ')}.`));
			}
			if (missing.length > 0) {
				console.log(
					dim(
						`  Not configured: ${missing.map((t) => t.label).join(', ')}. Those emails are\n` +
							'  logged to the Convex console until you re-run this step with their ids.'
					)
				);
			}
		}
	);

	// --- Step 10b: Upstash (one-shot waitlist import) ----------------------------
	let upstashConfigured = false;
	await step(
		'Waitlist import (Upstash Redis)',
		() => prodHas('UPSTASH_REDIS_REST_URL') && prodHas('UPSTASH_REDIS_REST_TOKEN'),
		async () => {
			describe([
				'The pre-Convex marketing site collected signups in an Upstash Redis',
				'sorted set (key `waitlist`, member = email, score = signup time).',
				'src/lib/convex/waitlistImport.ts brings those across and sends each of',
				'them the confirmation they never got, so production needs the Redis',
				'credentials until that has run.',
				'',
				`  ${bold('1)')} ${cyan('https://console.upstash.com')} -> your database -> REST API`,
				`  ${bold('2)')} Copy ${cyan('UPSTASH_REDIS_REST_URL')} and ${cyan('UPSTASH_REDIS_REST_TOKEN')}`,
				'',
				dim('These are read by nothing else. Once the import has run, unset them'),
				dim('(the last step of this script prints the commands) - there is no reason'),
				dim('for a live deployment to keep credentials to a database it never'),
				dim('touches again. Skippable if the import is already done or the database'),
				dim('is already gone.')
			]);
			await pressEnterToOpen(rl, 'https://console.upstash.com', 'Open the Upstash console');
			const url = await ask(
				rl,
				'UPSTASH_REDIS_REST_URL (or Enter to skip)',
				devLocal('UPSTASH_REDIS_REST_URL') ?? undefined
			);
			if (!url) {
				console.log(dim('  Skipped. The waitlist import will refuse to run until these are set.'));
				return;
			}
			const token =
				(await askSecret(rl, 'UPSTASH_REDIS_REST_TOKEN')) || devLocal('UPSTASH_REDIS_REST_TOKEN');
			rl = createPrompt();
			if (!token) {
				console.log(dim('  No token given; skipping. Both values are needed together.'));
				return;
			}
			setConvexEnv(
				projectRoot,
				{ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token },
				CONVEX_PROD
			);
			upstashConfigured = true;
			console.log(green('  Stored the Upstash credentials on production.'));
		}
	);

	// --- Step 11: in-app feedback -------------------------------------------------
	await step(
		'In-app feedback notifications (Discord)',
		() => prodHas('FEEDBACK_BOT_TOKEN') && prodHas('FEEDBACK_CHANNEL_ID'),
		async () => {
			describe([
				'Feedback sent from the desktop app is stored in Convex and posted to a',
				'Discord channel, each report in its own thread. Point production at a',
				'different channel than dev so real reports do not land in test noise.',
				'',
				`  ${bold('1)')} ${cyan('https://discord.com/developers/applications')} -> New Application`,
				`  ${bold('2)')} ${cyan('Bot')} tab -> Reset Token -> copy it (it is shown once)`,
				`  ${bold('3)')} Paste it below; the scoped invite link is built from the token`,
				`  ${bold('4)')} In Discord: right-click the channel -> ${cyan('Copy Channel ID')}`,
				`     (needs ${bold('Settings > Advanced > Developer Mode')})`,
				'',
				dim('Skippable. Without both values feedback is still stored in the'),
				dim('`feedback` table, it is just logged to the Convex console.')
			]);
			const devBotToken = devConvex('FEEDBACK_BOT_TOKEN');
			await pressEnterToOpen(
				rl,
				'https://discord.com/developers/applications',
				'Open the Discord developer portal'
			);
			const botToken =
				(await askSecret(
					rl,
					`FEEDBACK_BOT_TOKEN (Enter to ${devBotToken ? 'reuse the dev bot' : 'skip'})`
				)) || devBotToken;
			rl = createPrompt();
			if (!botToken) {
				console.log(dim('  Skipped. Feedback will be logged to the Convex console instead.'));
				return;
			}
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
			setConvexEnv(
				projectRoot,
				{ FEEDBACK_BOT_TOKEN: botToken, FEEDBACK_CHANNEL_ID: channelId },
				CONVEX_PROD
			);
			console.log(green('  Stored FEEDBACK_BOT_TOKEN and FEEDBACK_CHANNEL_ID.'));
		}
	);

	// --- Step 12: push everything to Vercel --------------------------------------
	//
	// Not a step(): it is the flush of whatever the steps above collected, so it
	// has to run whenever anything was collected - including under --only, where
	// a step like `--only downloads` produces a Vercel-bound value and would
	// otherwise gather it and throw it away.
	const flushVercelEnv = async () => {
		const targets = [
			['production', vercelEnv.production],
			...(skipPreview ? [] : [['preview', vercelEnv.preview]])
		].filter(([, vars]) => Object.keys(vars).length > 0);

		if (targets.length === 0) return;
		heading('Vercel environment variables');

		describe([
			'What the SvelteKit server itself reads. PUBLIC_CONVEX_URL is not in the',
			'list on purpose: `convex deploy` injects it into the build (that is what',
			'--cmd-url-env-var-name does in the vercel:deploy script).'
		]);
		for (const [target, vars] of targets) {
			console.log(`  ${bold(target)}`);
			for (const name of Object.keys(vars)) {
				console.log(`    ${name}${SENSITIVE_VERCEL_VARS.has(name) ? dim('  (sensitive)') : ''}`);
			}
		}
		console.log('');

		const canPush = hasVercel && vercelLinked(projectRoot);
		if (canPush && (await askYesNo(rl, 'Push these to Vercel now?', true))) {
			let failed = 0;
			for (const [target, vars] of targets) {
				for (const [name, value] of Object.entries(vars)) {
					try {
						vercelEnvSet(projectRoot, name, value, target, {
							sensitive: SENSITIVE_VERCEL_VARS.has(name)
						});
						console.log(`  ${green('set')}   ${name} ${dim(`(${target})`)}`);
					} catch (error) {
						failed++;
						console.log(
							`  ${yellow('fail')}  ${name} ${dim(`(${target})`)}: ${
								error instanceof Error ? error.message.split('\n')[0] : error
							}`
						);
					}
				}
			}
			if (failed === 0) {
				console.log(green('\n  All environment variables are on Vercel.'));
				return;
			}
			console.log(yellow(`\n  ${failed} variable(s) did not push; writing the files instead.`));
		} else if (canPush) {
			console.log(dim('  Skipped the CLI push; writing the files instead.'));
		}

		// Fallback (and belt-and-braces after a partial failure): dotenv files the
		// Vercel dashboard can import directly.
		ensureGitignored(repoRoot, '.env.vercel.*');
		for (const [target, vars] of targets) {
			writeEnvFile(join(projectRoot, `.env.vercel.${target}`), vars);
			console.log(`  ${green('wrote')} apps/web/.env.vercel.${target}`);
		}
		console.log(
			dim('\n  Import them at Settings > Environment Variables > (…) > Import .env,\n') +
				dim('  selecting the matching environment, then delete the files.')
		);
	};

	await flushVercelEnv();

	rl.close();

	const onlyMatched = matched();
	if (only && onlyMatched === 0) {
		console.error(`\nNo step title matched "${only}", so nothing ran.`);
		console.error(
			dim(
				'Try one of: vercel project, build configuration, deploy keys, secrets,\n' +
					'keypair, core config, github, downloads, stripe, coupon, loops, waitlist\n' +
					'import, feedback'
			)
		);
		process.exit(1);
	}
	if (only) {
		console.log(`\n${green(bold(`Done (${onlyMatched} step${onlyMatched === 1 ? '' : 's'}).`))}`);
		return;
	}

	// --- what is left to do -------------------------------------------------------
	console.log(`\n${green(bold('Configuration complete.'))}`);

	console.log(`\n${bold('Deploy')}`);
	console.log('  Pushing to the default branch deploys through the Vercel Git integration.');
	console.log('  To deploy from here instead:');
	console.log(`    ${cyan('vercel --prod')}   ${dim('# from apps/web')}`);
	console.log(
		dim('  Either way the build runs `pnpm vercel:deploy`, which pushes the Convex\n') +
			dim('  functions with CONVEX_DEPLOY_KEY and then builds the site, so there is no\n') +
			dim('  separate `convex deploy` to remember.')
	);

	console.log(`\n${bold('Then, once it is live')}`);
	const checklist = [
		[
			'Domain',
			`point ${siteUrl.replace(/^https?:\/\//, '')} at the Vercel project, and check SITE_URL matches it exactly`
		],
		[
			'Sign-in',
			`sign in at ${siteUrl}/login - a redirect_uri mismatch means the OAuth app callback is wrong`
		],
		['Stripe', `send a test event to ${webhookUrl} and confirm a 200 in the Convex logs`],
		[
			'Waitlist',
			`pnpm --filter @super-review/web exec convex run settings:setWaitlistMode '{"enabled":true}' --prod`
		],
		[
			'Desktop',
			'commit public-key.ts and ship a release built from it, or activation rejects production tokens'
		],
		['Downloads', `the buttons resolve through /api/download against ${RELEASES_REPO}`]
	];
	for (const [label, text] of checklist) {
		console.log(`  ${bold(label.padEnd(11))} ${text}`);
	}

	if (upstashConfigured || prodHas('UPSTASH_REDIS_REST_URL')) {
		const run = (fn, argsJson) =>
			`  ${cyan(`pnpm --filter @super-review/web exec convex run ${fn} '${argsJson}' --prod`)}`;
		console.log(`\n${bold('Waitlist import')} ${dim('(one-shot, dry run each phase first)')}`);
		console.log(run('waitlistImport:importFromUpstash', '{"dryRun":true}'));
		console.log(run('waitlistImport:importFromUpstash', '{}'));
		console.log(run('waitlistImport:sendImportedConfirmations', '{"dryRun":true}'));
		console.log(run('waitlistImport:sendImportedConfirmations', '{}'));
		console.log(
			dim('  Check waitlistImport:importStatus between the two: the import is\n') +
				dim('  idempotent and inspectable, the mail-out is not undoable.')
		);
		console.log('  Then drop the credentials it needed:');
		console.log(
			`  ${cyan('pnpm --filter @super-review/web exec convex env remove --prod UPSTASH_REDIS_REST_URL')}`
		);
		console.log(
			`  ${cyan('pnpm --filter @super-review/web exec convex env remove --prod UPSTASH_REDIS_REST_TOKEN')}`
		);
	}

	const embeddedKids = Object.keys(readDesktopPublicKeys(projectRoot));
	if (embeddedKids.length > 1) {
		console.log(
			`\n${yellow('Note')} the desktop app embeds ${embeddedKids.length} license keys ` +
				`(${embeddedKids.join(', ')}).\n` +
				dim('     A shipped build trusts all of them. Drop the dev ones from\n') +
				dim('     apps/desktop/src/main/license/public-key.ts before a release if you\n') +
				dim('     want production to be the only issuer it accepts.')
		);
	}

	console.log(
		dim(
			'\nRe-run this script any time; finished steps are skipped. Use --only <text>\nto redo one thing.'
		)
	);
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
