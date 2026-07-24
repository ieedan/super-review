import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyDirtyOverlay, buildRepo } from './build.ts';
import { CLI_BIN, MARKER, REPO_ROOT, git, pathExists } from './lib.ts';

// One command that builds the `ledger` demo repo and leaves it in exactly the
// state a recording take starts from. See scripts/demo/README.md.

const SCENES = ['skills', 'tour', 'comments', 'tasks', 'staging'] as const;
type Scene = (typeof SCENES)[number];

interface Args {
	scene: Scene;
	out: string;
	force: boolean;
	seedComments: boolean;
}

function parseArgs(argv: string[]): Args {
	let scene: Scene = 'tour';
	// Build alongside this monorepo under the same github/ folder, named after the
	// project itself (github/ledger) so it reads like a real repo on camera.
	let out = path.resolve(REPO_ROOT, '..', 'ledger');
	let force = false;
	let seedCommentsFlag = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--scene') {
			const value = argv[++i];
			if (!SCENES.includes(value as Scene)) {
				fail(`unknown scene "${value}". One of: ${SCENES.join(', ')}`);
			}
			scene = value as Scene;
		} else if (arg === '--out') {
			out = path.resolve(argv[++i] ?? '');
		} else if (arg === '--force') {
			force = true;
		} else if (arg === '--seed-comments') {
			seedCommentsFlag = true;
		} else if (arg === '--help' || arg === '-h') {
			printUsage();
			process.exit(0);
		} else {
			fail(`unexpected argument "${arg}"`);
		}
	}

	return { scene, out, force, seedComments: seedCommentsFlag };
}

function printUsage(): void {
	console.log(`
Build the ledger demo repo for a recording take.

  pnpm demo:seed --scene <name> [--out <path>] [--force] [--seed-comments]

Scenes:
  skills     main, clean, no .claude/, for the "Configure AI files" install
  tour       feat/settle-up with a committed guided tour
  comments   feat/settle-up, ready for review comments (add --seed-comments to prewrite them)
  tasks      feat/recurring with a committed task list
  staging    feat/settle-up with a mixed dirty tree for hunk staging

  --out            where to build (default: ../ledger, a sibling of this repo)
  --force          overwrite an existing demo repo at --out
  --seed-comments  prewrite the review comments (rehearsal only; real takes leave them live)
`);
}

function fail(message: string): never {
	console.error(`demo:seed: ${message}`);
	process.exit(1);
}

// Refuse to wipe a path unless it is empty or a demo repo we previously built
// (marked by MARKER). --force still requires the marker: it overwrites *a demo
// repo*, never an arbitrary directory the path happens to point at.
async function guardOut(out: string, force: boolean): Promise<void> {
	if (!(await pathExists(out))) return;

	const isMarked = await pathExists(path.join(out, MARKER));
	if (isMarked) {
		if (!force) fail(`${out} already exists. Re-run with --force to rebuild it.`);
		return;
	}

	const entries = await fs.readdir(out).catch(() => [] as string[]);
	if (entries.length === 0) return;

	fail(
		`${out} exists and is not a demo repo (no ${MARKER} marker). ` +
			`Refusing to touch it. Pass a different --out.`
	);
}

const SCENE_STEPS: Record<Scene, { branch: string; steps: string[] }> = {
	skills: {
		branch: 'main',
		steps: [
			'Add the repo, stay on the Branch/main view.',
			'Click "Configure AI files" and install the skills + tour-author subagent.',
			'The new .claude/ files show up as an added-files diff.'
		]
	},
	tour: {
		branch: 'feat/settle-up',
		steps: [
			'Switch to the feat/settle-up branch.',
			'Open the Sessions tab and start the "Settle up" tour.',
			'Walk the five steps; the callouts sit on the money, split, settle, and each-key lines.',
			"The commit box is pre-filled from the tour's commitTitle."
		]
	},
	comments: {
		branch: 'feat/settle-up',
		steps: [
			'Review the feat/settle-up branch against main.',
			'Leave comments on settle.ts, split.ts, money.ts, and SettleUpSheet.svelte.',
			'Run /resolve-comments so the agent replies and resolves each one.'
		]
	},
	tasks: {
		branch: 'feat/recurring',
		steps: [
			'Switch to the feat/recurring branch and open the Tasks panel.',
			'Four recurring-expenses tasks are queued.',
			'Run /loop-tasks and watch the list drain, each task linking to its diff.'
		]
	},
	staging: {
		branch: 'feat/settle-up',
		steps: [
			'Open the working-tree (Unstaged) diff on feat/settle-up.',
			'settle.ts has the fix in one hunk and a leftover console.log in another.',
			'Stage the fix hunk and the new rounding.ts; leave the debug line and the package.json bump.',
			'Commit with the pre-filled title; git diff still shows the console.log.'
		]
	}
};

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (!(await pathExists(CLI_BIN))) {
		fail(`the CLI is not built at ${CLI_BIN}. Run \`pnpm build:cli\` first.`);
	}

	await guardOut(args.out, args.force);

	console.log(`Building ledger demo at ${args.out} ...`);
	await buildRepo(args.out);

	const scene = SCENE_STEPS[args.scene];

	if (args.scene === 'skills') {
		// The skills scene needs a clean tree with no committed AI config, which is
		// exactly main as built. Nothing extra to do.
	} else if (args.scene === 'staging') {
		await applyDirtyOverlay(args.out);
	} else {
		await git(['checkout', scene.branch], { cwd: args.out });
	}

	let seededComments = 0;
	if (args.seedComments) {
		if (args.scene !== 'comments') {
			console.warn('--seed-comments only applies to the comments scene; seeding anyway.');
		}
		// Loaded lazily so the common scenes never pull in the native libSQL driver.
		const { seedComments } = await import('./seed-comments.ts');
		seededComments = await seedComments(args.out);
	}

	console.log(`\n✓ Scene "${args.scene}" ready on branch ${scene.branch}.\n`);
	console.log('On camera:');
	for (const step of scene.steps) console.log(`  • ${step}`);
	if (seededComments > 0) {
		console.log(`\n  (${seededComments} review comments pre-seeded for rehearsal.)`);
	}
	console.log(`\nAdd this repo in Super Review:\n  ${args.out}\n`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
