// Wipes the dev Convex deployment's test data so the licensing flows can be
// retested from scratch. Wraps `convex run adminReset:wipe`, deriving the
// deployment name and building the confirmation phrase so it never has to be
// retyped by hand.
//
// Safety: refuses to run unless CONVEX_DEPLOYMENT is a `dev:` deployment, so it
// cannot be pointed at prod. The `settings` row (waitlistMode) is preserved by
// the mutation itself.
//
// Run from apps/web with `pnpm reset:db`. Pass --yes to skip the prompt.
import { execFileSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const ESC = '\x1b[';
const bold = (s) => `${ESC}1m${s}${ESC}0m`;
const red = (s) => `${ESC}31m${s}${ESC}0m`;
const green = (s) => `${ESC}32m${s}${ESC}0m`;
const dim = (s) => `${ESC}2m${s}${ESC}0m`;

const deployment = process.env.CONVEX_DEPLOYMENT ?? '';
const convexUrl = process.env.PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? '';

if (!deployment.startsWith('dev:')) {
	console.error(
		red(
			`Refusing to reset: CONVEX_DEPLOYMENT is "${deployment || '(unset)'}", not a dev deployment.`
		)
	);
	console.error(dim('This script only wipes dev deployments. Aborting.'));
	process.exit(1);
}

// The wipe mutation derives the same name from CONVEX_CLOUD_URL and requires the
// phrase to match, so build it from the deployment URL rather than guessing.
const name = convexUrl.replace(/^https?:\/\//, '').replace(/\.convex\.cloud$/, '');
if (!name) {
	console.error(red('Could not derive the deployment name from PUBLIC_CONVEX_URL / CONVEX_URL.'));
	process.exit(1);
}
const confirm = `DELETE ALL DATA ON ${name}`;

const skipPrompt = process.argv.includes('--yes') || process.argv.includes('-y');
if (!skipPrompt) {
	const rl = readline.createInterface({ input, output });
	const answer = await rl.question(
		`${bold('Wipe all test data on ')}${bold(green(name))}${bold('? ')}${dim('(y/N) ')}`
	);
	rl.close();
	if (answer.trim().toLowerCase() !== 'y') {
		console.log('Aborted.');
		process.exit(0);
	}
}

execFileSync('npx', ['convex', 'run', 'adminReset:wipe', JSON.stringify({ confirm })], {
	stdio: 'inherit'
});
