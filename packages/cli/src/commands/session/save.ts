import { Command } from 'commander';
import path from 'node:path';
import {
	captureSession,
	findSessionByKey,
	getCurrentBranch,
	getDefaultBranch,
	getSession,
	writeSession,
	type DiffContext,
	type HarnessKind,
	type SessionMeta,
	type TourStepInput
} from '@super-review/core';
import { fail, repoRoot } from '../../util';

// The JSON document an agent passes via `--tour` to author a guided tour.
// Top-level metadata is optional here (flags can supply it instead); `steps`
// is the tour itself.
interface TourFile {
	name?: string;
	description?: string;
	commitTitle?: string;
	harness?: string;
	harnessLabel?: string;
	harnessUrl?: string;
	steps?: TourStepInput[];
}

const HARNESSES: HarnessKind[] = ['claude-code', 'cursor', 'codex', 'opencode', 'copilot', 'other'];

// Extra help shown under `session save --help`: the prose the auto-generated
// option list can't convey on its own.
const SAVE_HELP = `
Captures a frozen snapshot of the working tree's current changes so they can be
reviewed as an isolated session in the super-review desktop app.

--tour JSON shape:
  {
    "name": "...", "description": "...", "harness": "claude-code",
    "commitTitle": "feat: add detection layer",
    "steps": [
      { "title": "Detection layer",
        "body": "Markdown explaining what these files do and why.",
        "files": ["src/a.ts", "src/b.ts"] }
    ]
  }
A "commitTitle" (or --commit-title) is a short conventional-commit-style line
the desktop app uses to pre-fill the commit box for these changes.
List files in reading order. When a tour is given, the session captures ONLY
the files the tour references — so list every file you changed. A changed file
left out of the tour is not captured. (Without a tour, every changed file is
captured ungrouped.)

Documenting committed changes:
  By default the diff is the working tree (uncommitted edits). To document
  changes you've already committed, pass --committed: it captures this branch
  diffed against its base (auto-detected default branch, e.g. main). Override
  with --base <ref> and/or --head <ref>. Passing --base or --head implies
  --committed.`;

interface SaveOptions {
	key?: string;
	id?: string;
	name?: string;
	description?: string;
	commitTitle?: string;
	harness?: string;
	harnessLabel?: string;
	harnessUrl?: string;
	tour?: string;
	cwd?: string;
	committed?: boolean;
	base?: string;
	head?: string;
}

// Parse a `--tour` document from the inline JSON string passed on the command
// line. Validates the shape just enough to give a clear error before capture.
function loadTour(raw: string): TourFile {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		fail('--tour is not valid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null) {
		fail('--tour must be a JSON object');
	}
	const tour = parsed as TourFile;
	if (tour.commitTitle !== undefined && typeof tour.commitTitle !== 'string') {
		fail('--tour `commitTitle` must be a string');
	}
	if (tour.steps !== undefined) {
		if (!Array.isArray(tour.steps)) fail('--tour `steps` must be an array');
		tour.steps.forEach((step, i) => {
			if (!step || typeof step.title !== 'string' || !step.title.trim()) {
				fail(`--tour step ${i + 1} is missing a non-empty "title"`);
			}
			if (
				!Array.isArray(step.files) ||
				step.files.length === 0 ||
				!step.files.every((f) => typeof f === 'string')
			) {
				fail(`--tour step ${i + 1} ("${step.title}") needs a non-empty "files" array of paths`);
			}
			if (step.callouts !== undefined) {
				if (!Array.isArray(step.callouts)) {
					fail(`--tour step ${i + 1} ("${step.title}") "callouts" must be an array`);
				}
				step.callouts.forEach((c, j) => {
					const where = `step ${i + 1} callout ${j + 1}`;
					if (!c || typeof c.file !== 'string') {
						fail(`--tour ${where} needs a "file" string`);
					}
					if (typeof c.startLine !== 'number') {
						fail(`--tour ${where} needs a numeric "startLine"`);
					}
					if (typeof c.body !== 'string' || !c.body.trim()) {
						fail(`--tour ${where} needs a non-empty "body"`);
					}
				});
			}
		});
	}
	return tour;
}

async function runSave(opts: SaveOptions): Promise<void> {
	// A --tour document can supply metadata + the steps; explicit flags win
	// over its top-level fields.
	const tour = opts.tour ? loadTour(opts.tour) : null;

	const harnessRaw = opts.harness ?? tour?.harness;
	if (harnessRaw && !HARNESSES.includes(harnessRaw as HarnessKind)) {
		fail(`invalid --harness "${harnessRaw}". Expected one of: ${HARNESSES.join(', ')}`);
	}

	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	// Locate any existing session to update: explicit --id wins, else --key.
	let existing = null;
	if (opts.id) {
		existing = await getSession(root, opts.id);
		if (!existing) fail(`no session with id "${opts.id}" for this repo`);
	} else if (opts.key) {
		existing = await findSessionByKey(root, opts.key);
	}

	const name = opts.name ?? tour?.name;
	const description = opts.description ?? tour?.description;
	if (!existing && (!name || !description)) {
		fail('--name and --description are required when creating a new session');
	}

	const meta: SessionMeta = {
		key: opts.key,
		name,
		description,
		commitTitle: (opts.commitTitle ?? tour?.commitTitle)?.trim() || undefined,
		harness: harnessRaw ? (harnessRaw as HarnessKind) : undefined,
		harnessLabel: opts.harnessLabel ?? tour?.harnessLabel,
		harnessUrl: opts.harnessUrl ?? tour?.harnessUrl,
		steps: tour?.steps
	};

	// Working tree by default; --committed (or supplying --base/--head) switches
	// to a base...head branch diff so already-committed changes can be documented.
	const committedMode = Boolean(opts.committed || opts.base || opts.head);
	let ctx: DiffContext | undefined;
	if (committedMode) {
		const base = opts.base ?? (await getDefaultBranch(root));
		if (!base) {
			fail('could not determine a base branch to diff against; pass --base <ref>');
		}
		const head = opts.head ?? (await getCurrentBranch(root)) ?? 'HEAD';
		ctx = { kind: 'branch', base, head };
	}

	const session = await captureSession(root, meta, existing, ctx);
	if (session.fileCount === 0) {
		fail(
			committedMode
				? `no committed changes on ${ctx!.kind === 'branch' ? ctx!.head : 'HEAD'} vs ${
						ctx!.kind === 'branch' ? ctx!.base : 'base'
					} to capture`
				: 'no working-tree changes to capture'
		);
	}

	// Warn about authored tour paths that didn't match any captured change (typo,
	// or a file that's not part of this diff) — they're silently dropped from the
	// tour, so surface them rather than letting them vanish.
	if (tour?.steps) {
		const captured = new Set(session.files.map((f) => f.path));
		const missing = [
			...new Set(
				tour.steps
					.flatMap((s) => [...s.files, ...(s.callouts ?? []).map((c) => c.file)])
					.filter((p) => !captured.has(p))
			)
		];
		if (missing.length > 0) {
			console.error(
				`warning: ${missing.length} tour path(s) not in the captured changes (dropped):\n` +
					missing.map((p) => `  - ${p}`).join('\n')
			);
		}
	}

	await writeSession(root, session);

	const verb = existing ? 'updated' : 'created';
	const stepNote = session.stepCount > 0 ? `, ${session.stepCount} tour step(s)` : '';
	console.log(
		`${verb} session "${session.name}" (${session.id})\n` +
			`  ${session.fileCount} file(s), +${session.additions} −${session.deletions}${stepNote}`
	);
}

export const save = new Command('save')
	.description(
		"capture the working tree's current changes (or, with --committed, this branch's committed changes) as a reviewable session"
	)
	.option(
		'--key <id>',
		'Stable upsert key (your harness conversation/run id). Re-running with the same key UPDATES that session.'
	)
	.option('--id <id>', 'Target an existing session by its id (alternative to --key).')
	.option('--name <text>', 'Session name (required on first save).')
	.option('--description <text>', 'What you changed (required on first save).')
	.option(
		'--commit-title <text>',
		'A short, conventional-commit-style title (e.g. "feat: add X") suggested for committing these changes. The desktop app uses it to pre-fill the commit box.'
	)
	.option('--harness <kind>', `One of: ${HARNESSES.join(', ')} (default: other).`)
	.option('--harness-label <text>', 'Freeform harness name (used when --harness other).')
	.option('--harness-url <url>', 'Deep link back to this run (resume/permalink).')
	.option(
		'--committed',
		'Capture this branch diffed against its base (auto-detected default branch) instead of the working tree, so already-committed changes can be documented.'
	)
	.option(
		'--base <ref>',
		'Base ref to diff against (implies --committed). Defaults to the auto-detected default branch.'
	)
	.option('--head <ref>', 'Head ref to diff (implies --committed). Defaults to the current branch.')
	.option(
		'--tour <json>',
		"Inline JSON describing a guided tour: ordered steps that group related files with commentary, so the reviewer reads the change as a narrative. Flags override the document's top-level name/description/harness."
	)
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.addHelpText('after', SAVE_HELP)
	.action(runSave);
