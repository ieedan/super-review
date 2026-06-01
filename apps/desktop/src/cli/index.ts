#!/usr/bin/env node
import { simpleGit } from 'simple-git';
import path from 'node:path';
import { captureSession, type SessionMeta, type TourStepInput } from '../main/session-capture.js';
import {
	clearSessions,
	findSessionByKey,
	getSession,
	listSessions,
	writeSession
} from '../main/session-store.js';
import type { HarnessKind } from '@shared/types.js';

// The JSON document an agent passes via `--tour` to author a guided tour.
// Top-level metadata is optional here (flags can supply it instead); `steps`
// is the tour itself.
interface TourFile {
	name?: string;
	description?: string;
	harness?: string;
	harnessLabel?: string;
	harnessUrl?: string;
	steps?: TourStepInput[];
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

const HARNESSES: HarnessKind[] = ['claude-code', 'cursor', 'codex', 'opencode', 'copilot', 'other'];

const USAGE = `super-review — document an agent session for review

Usage:
  super-review session save [options]
  super-review session clear [--cwd <path>]

Sessions are stored in the repo under .super-review/sessions/, so they can be
committed and travel with a branch/PR. Run "session clear" to remove them all
(e.g. before merging) — git then sees the committed manifests as deleted.

Options:
  --key <id>           Stable upsert key (your harness conversation/run id).
                       Re-running with the same key UPDATES that session.
  --id <id>            Target an existing session by its id (alternative to --key).
  --name <text>        Session name (required on first save).
  --description <text> What you changed (required on first save).
  --harness <kind>     One of: ${HARNESSES.join(', ')} (default: other).
  --harness-label <t>  Freeform harness name (used when --harness other).
  --harness-url <url>  Deep link back to this run (resume/permalink).
  --tour <json>        Inline JSON describing a guided tour: ordered steps that
                       group related files with commentary, so the reviewer
                       reads the change as a narrative. Flags override the
                       document's top-level name/description/harness.
  --cwd <path>         Repo path (default: current directory).
  -h, --help           Show this help.

Captures a frozen snapshot of the working tree's current changes so they can be
reviewed as an isolated session in the super-review desktop app.

--tour JSON shape:
  {
    "name": "...", "description": "...", "harness": "claude-code",
    "steps": [
      { "title": "Detection layer",
        "body": "Markdown explaining what these files do and why.",
        "files": ["src/a.ts", "src/b.ts"] }
    ]
  }
List files in reading order; any changed file you omit still shows, grouped
under "Other changes" at the end.`;

// Minimal --flag value parser. Unknown flags are reported rather than ignored.
function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '-h' || arg === '--help') {
			out.help = 'true';
			continue;
		}
		if (!arg.startsWith('--')) {
			throw new Error(`Unexpected argument: ${arg}`);
		}
		const name = arg.slice(2);
		const value = argv[i + 1];
		if (value === undefined || value.startsWith('--')) {
			throw new Error(`Missing value for --${name}`);
		}
		out[name] = value;
		i++;
	}
	return out;
}

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

async function repoRoot(cwd: string): Promise<string> {
	try {
		const top = await simpleGit(cwd).revparse(['--show-toplevel']);
		return top.trim();
	} catch {
		fail(`not a git repository: ${cwd}`);
	}
}

async function run(): Promise<void> {
	const [command, sub, ...rest] = process.argv.slice(2);

	if (command === 'session' && sub === 'save') {
		const args = parseArgs(rest);
		if (args.help) {
			console.log(USAGE);
			return;
		}

		// A --tour document can supply metadata + the steps; explicit flags win
		// over its top-level fields.
		const tour = args.tour ? loadTour(args.tour) : null;

		const harnessRaw = args.harness ?? tour?.harness;
		if (harnessRaw && !HARNESSES.includes(harnessRaw as HarnessKind)) {
			fail(`invalid --harness "${harnessRaw}". Expected one of: ${HARNESSES.join(', ')}`);
		}

		const cwd = path.resolve(args.cwd ?? process.cwd());
		const root = await repoRoot(cwd);

		// Locate any existing session to update: explicit --id wins, else --key.
		let existing = null;
		if (args.id) {
			existing = await getSession(root, args.id);
			if (!existing) fail(`no session with id "${args.id}" for this repo`);
		} else if (args.key) {
			existing = await findSessionByKey(root, args.key);
		}

		const name = args.name ?? tour?.name;
		const description = args.description ?? tour?.description;
		if (!existing && (!name || !description)) {
			fail('--name and --description are required when creating a new session');
		}

		const meta: SessionMeta = {
			key: args.key,
			name,
			description,
			harness: harnessRaw ? (harnessRaw as HarnessKind) : undefined,
			harnessLabel: args['harness-label'] ?? tour?.harnessLabel,
			harnessUrl: args['harness-url'] ?? tour?.harnessUrl,
			steps: tour?.steps
		};

		const session = await captureSession(root, meta, existing);
		if (session.fileCount === 0) {
			fail('no working-tree changes to capture');
		}

		// Warn about authored tour paths that didn't match any working-tree change
		// (typo, or a file that's no longer modified) — they're silently dropped
		// from the tour, so surface them rather than letting them vanish.
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
					`warning: ${missing.length} tour path(s) not in the working-tree changes (dropped):\n` +
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
		return;
	}

	if (command === 'session' && sub === 'clear') {
		const args = parseArgs(rest);
		if (args.help) {
			console.log(USAGE);
			return;
		}
		const cwd = path.resolve(args.cwd ?? process.cwd());
		const root = await repoRoot(cwd);
		const count = (await listSessions(root)).length;
		await clearSessions(root);
		console.log(
			count === 0
				? 'no sessions to clear'
				: `cleared ${count} session${count === 1 ? '' : 's'} from .super-review/sessions/`
		);
		return;
	}

	if (!command || command === '--help' || command === '-h') {
		console.log(USAGE);
		return;
	}

	fail(`unknown command: ${[command, sub].filter(Boolean).join(' ')}\n\n${USAGE}`);
}

run().catch((err) => {
	fail(err instanceof Error ? err.message : String(err));
});
