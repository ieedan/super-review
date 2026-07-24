import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FIXTURES, MARKER, authorEnv, cli, copyTree, git, readJson, type RunOpts } from './lib.ts';

// The two fictional committers, so the History tab shows more than one avatar.
// Deliberately non-GitHub emails: a real handle would make the app fetch a live
// avatar over the network mid-demo.
const AIDAN = { name: 'Aidan Bleser', email: 'aidan@ledger.local' };
const JORDAN = { name: 'Jordan Vega', email: 'jordan@ledger.local' };

// A single backdated commit of a subset of the (already-copied) working tree.
interface CommitStep {
	message: string;
	who: { name: string; email: string };
	date: string;
	paths: string[];
}

async function commitGroup(repo: string, step: CommitStep): Promise<void> {
	const opts: RunOpts = { cwd: repo, env: authorEnv(step.who.name, step.who.email, step.date) };
	await git(['add', '--', ...step.paths], opts);
	await git(['commit', '-m', step.message], opts);
}

// ─── main: the baseline ──────────────────────────────────────────────────────
// The whole base tree is copied up front, then committed in ordered groups so
// the history reads like the app was actually built piece by piece.
const BASE_HISTORY: CommitStep[] = [
	{
		message: 'chore: scaffold SvelteKit project',
		who: AIDAN,
		date: '2026-06-08T09:12:00',
		paths: [
			'package.json',
			'svelte.config.js',
			'vite.config.ts',
			'tsconfig.json',
			'.gitignore',
			'src/app.css',
			'src/app.html'
		]
	},
	{
		message: 'feat: money as integer cents',
		who: AIDAN,
		date: '2026-06-09T14:40:00',
		paths: ['src/lib/types.ts', 'src/lib/money.ts']
	},
	{
		message: 'feat: equal split with remainder handling',
		who: JORDAN,
		date: '2026-06-11T11:05:00',
		paths: ['src/lib/split.ts']
	},
	{
		message: 'test: cover the money and split math',
		who: JORDAN,
		date: '2026-06-11T16:22:00',
		paths: ['tests/money.test.ts', 'tests/split.test.ts']
	},
	{
		message: 'feat: store and localStorage persistence',
		who: AIDAN,
		date: '2026-06-15T10:18:00',
		paths: ['src/lib/store.svelte.ts', 'src/lib/db.ts']
	},
	{
		message: 'feat: member avatars and the balance card',
		who: JORDAN,
		date: '2026-06-17T13:47:00',
		paths: ['src/lib/components/MemberAvatar.svelte', 'src/lib/components/BalanceCard.svelte']
	},
	{
		message: 'feat: expense list, form, and group routes',
		who: AIDAN,
		date: '2026-06-19T15:31:00',
		paths: [
			'src/lib/components/ExpenseList.svelte',
			'src/lib/components/ExpenseForm.svelte',
			'src/routes/+layout.svelte',
			'src/routes/+page.svelte',
			'src/routes/groups/[id]/+page.svelte'
		]
	},
	{
		message: 'chore: changesets, readme, and branding',
		who: JORDAN,
		date: '2026-06-22T09:05:00',
		paths: ['.changeset/config.json', '.changeset/README.md', 'README.md', 'static']
	}
];

// The settle-up feature, committed in three logical steps on feat/settle-up.
const SETTLE_HISTORY: CommitStep[] = [
	{
		message: 'feat: settle-up algorithm and weighted splits',
		who: AIDAN,
		date: '2026-07-20T10:30:00',
		paths: ['src/lib/types.ts', 'src/lib/money.ts', 'src/lib/split.ts', 'src/lib/settle.ts']
	},
	{
		message: 'feat: settle-up sheet and split-kind picker',
		who: AIDAN,
		date: '2026-07-21T14:12:00',
		paths: [
			'src/lib/store.svelte.ts',
			'src/lib/components/SettleUpSheet.svelte',
			'src/lib/components/BalanceCard.svelte',
			'src/lib/components/ExpenseForm.svelte',
			'src/routes/groups/[id]/+page.svelte'
		]
	},
	{
		message: 'test: settle-up specs, deps, and release notes',
		who: AIDAN,
		date: '2026-07-22T09:48:00',
		paths: [
			'tests/settle.test.ts',
			'tests/split.test.ts',
			'tests/money.test.ts',
			'package.json',
			'static/og.png',
			'.changeset/settle-up.md'
		]
	}
];

interface TaskFixture {
	branch: string;
	tasks: { title: string; notes?: string }[];
}

// Build the whole repo (main, feat/settle-up with its committed tour, and
// feat/recurring with its committed task list) from scratch. Leaves the repo
// checked out on main; the caller checks out the scene's branch afterward.
export async function buildRepo(out: string): Promise<void> {
	await fs.rm(out, { recursive: true, force: true });
	await fs.mkdir(out, { recursive: true });

	// The ownership marker (see MARKER): written first, ignored by git so it
	// never shows up as a change in the app.
	await fs.writeFile(path.join(out, MARKER), 'super-review demo repo\n');
	await git(['init', '-b', 'main'], { cwd: out });
	await fs.appendFile(path.join(out, '.git', 'info', 'exclude'), `\n${MARKER}\n`);

	// main.
	await copyTree(path.join(FIXTURES, 'base'), out);
	for (const step of BASE_HISTORY) await commitGroup(out, step);

	// feat/settle-up: overlay the changed files, commit them, then author and
	// commit the guided tour against main..feat/settle-up.
	await git(['checkout', '-b', 'feat/settle-up'], { cwd: out });
	await copyTree(path.join(FIXTURES, 'settle-up'), out);
	for (const step of SETTLE_HISTORY) await commitGroup(out, step);
	await authorTour(out);

	// feat/recurring: a fresh branch off main carrying only a committed task list.
	await git(['checkout', '-b', 'feat/recurring', 'main'], { cwd: out });
	await seedTasks(out);

	await git(['checkout', 'main'], { cwd: out });
}

// Run the CLI to capture the committed settle-up diff as a session tour, then
// commit the generated manifest onto the branch so it travels with it.
async function authorTour(out: string): Promise<void> {
	const tour = await readJson<unknown>('tours/settle-up.json');
	await cli(
		[
			'session',
			'save',
			'--committed',
			'--base',
			'main',
			'--head',
			'feat/settle-up',
			'--key',
			'demo-settle-up',
			'--tour',
			JSON.stringify(tour),
			'--cwd',
			out
		],
		{ cwd: out }
	);
	const opts: RunOpts = {
		cwd: out,
		env: authorEnv(AIDAN.name, AIDAN.email, '2026-07-22T10:15:00')
	};
	await git(['add', '--', '.super-review/sessions'], opts);
	await git(['commit', '-m', 'docs: guided review tour for settle-up'], opts);
}

// Add each task from the fixture to feat/recurring via the CLI, then commit the
// list so it is part of the branch.
async function seedTasks(out: string): Promise<void> {
	const fixture = await readJson<TaskFixture>('tasks/recurring.json');
	for (const task of fixture.tasks) {
		const args = [
			'task',
			'add',
			task.title,
			'--branch',
			fixture.branch,
			'--harness',
			'claude-code',
			'--cwd',
			out
		];
		if (task.notes) args.push('--notes', task.notes);
		await cli(args, { cwd: out });
	}
	const opts: RunOpts = {
		cwd: out,
		env: authorEnv(AIDAN.name, AIDAN.email, '2026-07-23T08:30:00')
	};
	await git(['add', '--', '.super-review/tasks'], opts);
	await git(['commit', '-m', 'chore: queue the recurring-expenses task list'], opts);
}

// Lay the mixed dirty working tree for the staging scene over feat/settle-up:
// a real fix plus a leftover debug line in settle.ts, an unrelated reorder in
// the store, an accidental dependency bump, and one new untracked file.
export async function applyDirtyOverlay(out: string): Promise<void> {
	await git(['checkout', 'feat/settle-up'], { cwd: out });
	await copyTree(path.join(FIXTURES, 'dirty'), out);
}
