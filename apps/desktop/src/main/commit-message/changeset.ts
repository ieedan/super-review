// Changeset generation: the same harness CLIs that write commit messages, turned
// loose on the branch instead.
//
// Unlike a commit message, nothing useful can be pasted into the prompt here — a
// branch's diff is far too big to inline, and deciding how many changesets it
// deserves means actually reading the work. So the agent gets tools and the repo,
// and writes the `.changeset/*.md` files itself. The prompt is what keeps it to
// that; this module checks afterwards, by reading the directory before and after
// and by asking git whether anything else moved.
import type {
	GenerateChangesetRequest,
	GenerateChangesetResult,
	GeneratedChangesetFile
} from '@super-review/core/types';
import { changesetFilesWritten, getChangesetBrief, readChangesetFiles } from '@super-review/core';
import { runAdapter } from './adapters/index.js';
import type { AdapterInput, AdapterResult } from './adapters/types.js';
import { clampStatus } from './activity.js';
import { buildChangesetPrompt } from './changeset-prompt.js';
import { resolveHarnessForRun } from './detect.js';
import { listDirtyPaths } from './stray-paths.js';

export interface GenerateChangesetOptions {
	onActivity?: (status: string) => void;
}

let activeAbort: AbortController | null = null;

export function cancelChangesetGeneration(): boolean {
	if (!activeAbort) return false;
	activeAbort.abort();
	activeAbort = null;
	return true;
}

export async function generateChangeset(
	repoPath: string,
	request: GenerateChangesetRequest,
	options?: GenerateChangesetOptions
): Promise<GenerateChangesetResult> {
	// One generation at a time: cancel any in-flight run before starting.
	cancelChangesetGeneration();
	const abort = new AbortController();
	activeAbort = abort;

	try {
		const brief = await getChangesetBrief(repoPath);
		if (!brief) {
			return {
				ok: false,
				code: 'not-installed',
				error: 'This repository does not use changesets.'
			};
		}
		if (brief.packages.length === 0) {
			return {
				ok: false,
				code: 'failed',
				error: 'No releasable packages found in this workspace.'
			};
		}

		const resolved = await resolveHarnessForRun(request.preferredHarness);
		if (!resolved.ok) {
			return {
				ok: false,
				code: resolved.code,
				error: resolved.error,
				...(resolved.code === 'auth' ? { harness: resolved.harness } : {})
			};
		}
		const { harness, binary } = resolved;

		if (abort.signal.aborted) {
			return { ok: false, harness, code: 'cancelled', error: 'Cancelled' };
		}

		// Snapshots to judge the run by: which changesets existed, and what was
		// already dirty (so pre-existing edits aren't blamed on the agent).
		const [before, dirtyBefore] = await Promise.all([
			readChangesetFiles(repoPath),
			listDirtyPaths(repoPath)
		]);

		const input: AdapterInput = {
			binary,
			cwd: repoPath,
			prompt: buildChangesetPrompt({
				branch: request.branch,
				brief,
				basePrompt: request.basePrompt
			}),
			// Only the user's own choice. Left unset, the adapter picks the model for
			// the job — the cheap tier that writes a commit message from a patch that
			// is already in the prompt is not the tier that can read a branch and
			// decide what it adds up to.
			model: request.model?.trim() || undefined,
			tools: 'workspace',
			signal: abort.signal,
			onActivity: options?.onActivity
				? (status) => options.onActivity?.(clampStatus(status))
				: undefined
		};

		let result: AdapterResult;
		try {
			result = await runAdapter(harness, input);
		} catch (err) {
			if (abort.signal.aborted) {
				return { ok: false, harness, code: 'cancelled', error: 'Cancelled' };
			}
			return {
				ok: false,
				harness,
				code: 'failed',
				error: err instanceof Error ? err.message : String(err)
			};
		}

		if (abort.signal.aborted) {
			return { ok: false, harness, code: 'cancelled', error: 'Cancelled' };
		}

		// The files are the output, so read them before judging the run: an agent
		// that writes three changesets and then says nothing has still done the job.
		const [after, dirtyAfter] = await Promise.all([
			readChangesetFiles(repoPath),
			listDirtyPaths(repoPath)
		]);
		const written = changesetFilesWritten(before, after);

		if (written.length === 0) {
			if (!result.ok) {
				return {
					ok: false,
					harness,
					code: result.code ?? 'failed',
					error: result.error ?? 'Failed to generate a changeset.'
				};
			}
			return {
				ok: false,
				harness,
				code: 'empty',
				error: 'The agent finished without writing a changeset.'
			};
		}

		const releasable = new Set(brief.packages.map((p) => p.name));
		const unknownPackages = [
			...new Set(written.flatMap((f) => f.packages).filter((name) => !releasable.has(name)))
		];
		const stray = strayPaths(dirtyBefore, dirtyAfter);

		return {
			ok: true,
			harness,
			written: written.map(toGeneratedFile),
			...(unknownPackages.length ? { unknownPackages } : {}),
			...(stray.length ? { strayPaths: stray } : {})
		};
	} finally {
		if (activeAbort === abort) activeAbort = null;
	}
}

function toGeneratedFile(file: {
	path: string;
	contents: string;
	packages: string[];
}): GeneratedChangesetFile {
	return { path: file.path, packages: file.packages, summary: firstLineOfBody(file.contents) };
}

// The summary a changeset leads with: the first non-empty line after the
// frontmatter, which is the line that ends up in the changelog.
function firstLineOfBody(contents: string): string {
	const body = contents.replace(/^---[\s\S]*?\r?\n---[ \t]*\r?\n?/, '');
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return '';
}

// Files the run left dirty that it had no business touching. Anything already
// dirty when it started is the user's own work, and `.changeset/` is the job.
function strayPaths(before: Set<string>, after: Set<string>): string[] {
	const stray: string[] = [];
	for (const path of after) {
		if (before.has(path)) continue;
		if (path.startsWith('.changeset/')) continue;
		stray.push(path);
	}
	return stray.sort();
}
