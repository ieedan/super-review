import type {
	CommitFileSelection,
	CommitMessageProgressEvent,
	GenerateCommitMessageRequest,
	GenerateCommitMessageResult
} from '@super-review/core/types';
import { getDiff } from '@super-review/core';
import { runAdapter } from './adapters/index.js';
import type { AdapterInput, AdapterResult } from './adapters/types.js';
import { resolveHarnessForRun } from './detect.js';
import { parseCommitMessageOutput } from './parse.js';
import { buildCommitMessagePrompt, concatenatePatches, summarizeSelections } from './prompt.js';
import { resolveCommitMessageModel } from './models.js';

export interface GenerateCommitMessageOptions {
	onProgress?: (event: CommitMessageProgressEvent) => void;
}

let activeAbort: AbortController | null = null;

export function cancelCommitMessageGeneration(): boolean {
	if (!activeAbort) return false;
	activeAbort.abort();
	activeAbort = null;
	return true;
}

export async function generateCommitMessage(
	repoPath: string,
	request: GenerateCommitMessageRequest,
	options?: GenerateCommitMessageOptions
): Promise<GenerateCommitMessageResult> {
	if (!request.selections.length) {
		return { ok: false, code: 'failed', error: 'No files selected for the commit.' };
	}

	// One generation at a time: cancel any in-flight run before starting.
	cancelCommitMessageGeneration();
	const abort = new AbortController();
	activeAbort = abort;

	try {
		const resolved = await resolveHarnessForRun(request.preferredHarness);
		if (!resolved.ok) {
			return { ok: false, code: 'no-harness', error: resolved.error };
		}
		const { harness, binary } = resolved;

		if (abort.signal.aborted) {
			return { ok: false, harness, code: 'cancelled', error: 'Cancelled' };
		}

		const selections = await ensurePatches(repoPath, request.selections);
		const prompt = buildCommitMessagePrompt({
			branch: request.branch,
			fileSummary: summarizeSelections(selections),
			patch: concatenatePatches(selections),
			basePrompt: request.basePrompt
		});

		// No placeholder progress: the renderer shows the waiting state until the
		// harness streams something, so every progress event is real output.
		const model = resolveCommitMessageModel(harness, request.model);
		const input: AdapterInput = {
			binary,
			cwd: repoPath,
			prompt,
			model: model || undefined,
			signal: abort.signal,
			onProgress: options?.onProgress
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

		if (!result.ok) {
			return {
				ok: false,
				harness,
				code: result.code ?? 'failed',
				error: result.error ?? 'Failed to generate a commit message.'
			};
		}

		// The harness answers with the message itself (subject, blank line, body);
		// some still wrap it in a fence or a JSON object, which the parser accepts.
		const parsed = parseCommitMessageOutput(result.text ?? '');
		if (!parsed) {
			return {
				ok: false,
				harness,
				code: 'empty',
				error: 'The agent returned no usable commit message.'
			};
		}

		return {
			ok: true,
			harness,
			subject: parsed.subject,
			body: parsed.body
		};
	} finally {
		if (activeAbort === abort) activeAbort = null;
	}
}

// Fill in patches for whole-file selections so the prompt always has a diff.
async function ensurePatches(
	repoPath: string,
	selections: CommitFileSelection[]
): Promise<CommitFileSelection[]> {
	const out: CommitFileSelection[] = [];
	for (const s of selections) {
		if (s.patch?.trim()) {
			out.push(s);
			continue;
		}
		try {
			const diff = await getDiff(repoPath, s.path, { kind: 'workingTree' });
			out.push({
				...s,
				patch: diff.patch || undefined
			});
		} catch {
			out.push(s);
		}
	}
	return out;
}
