import { Command } from 'commander';
import path from 'node:path';
import {
	captureSlice,
	findSliceByKey,
	getSlice,
	writeSlice,
	type HarnessKind,
	type SliceMeta,
	type SliceStepInput
} from '@super-review/core';
import { fail, repoRoot } from '../../util';

// The JSON document an agent passes via `--tour`. Top-level metadata is optional
// (flags can supply it instead); `steps` is the tour itself. `name` is accepted
// as an alias for `title` so documents authored for the old `session` command
// keep working.
interface TourFile {
	title?: string;
	name?: string;
	description?: string;
	harness?: string;
	author?: string;
	steps?: SliceStepInput[];
}

const HARNESSES: HarnessKind[] = ['claude-code', 'cursor', 'codex', 'opencode', 'copilot', 'other'];

const SAVE_HELP = `
Records a content-free "slice": where to look (paths + line-range callouts) and
what to say (narrative). Unlike the old frozen session, a slice stores NO code —
the diff is always recomputed live from the branch's changes (committed AND
uncommitted, vs the fork point) and filtered to the slice's files. Callouts are
auto-anchored to the line text, so they follow edits instead of drifting.

--tour JSON shape:
  {
    "title": "...", "description": "...", "harness": "claude-code",
    "steps": [
      { "title": "Detection layer",
        "body": "Markdown explaining what these files do and why.",
        "files": ["src/a.ts", "src/b.ts"],
        "callouts": [
          { "file": "src/a.ts", "startLine": 12, "endLine": 14,
            "side": "new", "body": "look right here" }
        ] }
    ]
  }
Line numbers are hints — they're auto-fingerprinted against the current diff and
re-resolved on every render, so they follow drift or surface as "outdated".

File scope: pass --files a,b,c to scope the slice to just your files, else it's
derived from every file the branch changed. List files in reading order.`;

interface SaveOptions {
	key?: string;
	id?: string;
	title?: string;
	description?: string;
	harness?: string;
	author?: string;
	authorKind?: string;
	files?: string;
	branch?: string;
	base?: string;
	tour?: string;
	cwd?: string;
}

// Parse and lightly validate a `--tour` document, mirroring the old session
// command's checks so authors get clear errors before capture.
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
					if (!c || typeof c.file !== 'string') fail(`--tour ${where} needs a "file" string`);
					if (typeof c.startLine !== 'number') fail(`--tour ${where} needs a numeric "startLine"`);
					if (typeof c.body !== 'string' || !c.body.trim()) {
						fail(`--tour ${where} needs a non-empty "body"`);
					}
				});
			}
		});
	}
	return tour;
}

// Shared implementation behind both `slice save` and the deprecated
// `session save` alias.
export async function runSliceSave(opts: SaveOptions): Promise<void> {
	const tour = opts.tour ? loadTour(opts.tour) : null;

	const harnessRaw = opts.harness ?? tour?.harness;
	if (harnessRaw && !HARNESSES.includes(harnessRaw as HarnessKind)) {
		fail(`invalid --harness "${harnessRaw}". Expected one of: ${HARNESSES.join(', ')}`);
	}

	const authorKind = opts.authorKind ?? 'agent';
	if (authorKind !== 'agent' && authorKind !== 'human') {
		fail(`invalid --author-kind "${authorKind}". Expected "agent" or "human".`);
	}

	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	// Locate any existing slice to update: explicit --id wins, else --key.
	let existing = null;
	if (opts.id) {
		existing = await getSlice(root, opts.id);
		if (!existing) fail(`no slice with id "${opts.id}" for this repo`);
	} else if (opts.key) {
		existing = await findSliceByKey(root, opts.key);
	}

	const title = opts.title ?? tour?.title ?? tour?.name;
	const description = opts.description ?? tour?.description;
	if (!existing && (!title || !description)) {
		fail('--title and --description are required when creating a new slice');
	}

	const authorName = opts.author ?? tour?.author;
	const meta: SliceMeta = {
		key: opts.key,
		title,
		description,
		branch: opts.branch,
		base: opts.base,
		author:
			authorName || harnessRaw
				? {
						kind: authorKind,
						name: authorName ?? harnessRaw ?? 'agent',
						harness: harnessRaw ? (harnessRaw as HarnessKind) : undefined
					}
				: undefined,
		steps: tour?.steps
	};

	const files = opts.files
		? opts.files
				.split(',')
				.map((f) => f.trim())
				.filter(Boolean)
		: undefined;

	const slice = await captureSlice(root, meta, existing, files);
	if (slice.files.length === 0) {
		fail('no branch changes to capture (nothing differs from the fork point)');
	}

	// Warn about authored tour paths that didn't match any changed file — they're
	// silently dropped, so surface them rather than letting them vanish.
	if (tour?.steps) {
		const captured = new Set(slice.files);
		const missing = [
			...new Set(
				tour.steps
					.flatMap((s) => [...s.files, ...(s.callouts ?? []).map((c) => c.file)])
					.filter((p) => !captured.has(p))
			)
		];
		if (missing.length > 0) {
			console.error(
				`warning: ${missing.length} tour path(s) not in the branch's changes (dropped):\n` +
					missing.map((p) => `  - ${p}`).join('\n')
			);
		}
	}

	await writeSlice(root, slice);

	const verb = existing ? 'updated' : 'created';
	const stepNote = slice.steps.length > 0 ? `, ${slice.steps.length} tour step(s)` : '';
	console.log(
		`${verb} slice "${slice.title}" (${slice.id})\n` +
			`  ${slice.files.length} file(s), +${slice.additions ?? 0} −${slice.deletions ?? 0}${stepNote}`
	);
}

export const save = new Command('save')
	.description("document this branch's changes as a content-free, live-rendering slice")
	.option(
		'--key <id>',
		'Stable upsert key (your harness conversation/run id). Re-running with the same key UPDATES that slice.'
	)
	.option('--id <id>', 'Target an existing slice by its id (alternative to --key).')
	.option('--title <text>', 'Slice title (required on first save).')
	.option('--description <text>', 'What you changed (required on first save).')
	.option('--harness <kind>', `One of: ${HARNESSES.join(', ')} (default: other).`)
	.option('--author <name>', 'Author display name (e.g. your harness or handle).')
	.option('--author-kind <kind>', 'One of: agent, human (default: agent).')
	.option(
		'--files <list>',
		"Comma-separated paths to scope the slice to (default: all of the branch's changed files)."
	)
	.option('--branch <name>', 'Branch this slice documents (default: the current branch).')
	.option(
		'--base <ref>',
		"Fork-point base the diff is computed against (default: the repo's detected default branch)."
	)
	.option(
		'--tour <json>',
		"Inline JSON describing a guided tour: ordered steps that group related files with commentary and line-range callouts. Flags override the document's top-level fields."
	)
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.addHelpText('after', SAVE_HELP)
	.action(runSliceSave);
