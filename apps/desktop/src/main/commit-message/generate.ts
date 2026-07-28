import type {
	CommitFileSelection,
	CommitMessageHarness,
	GenerateCommitMessageRequest,
	GenerateCommitMessageResult
} from '@super-review/core/types';
import { getDiff } from '@super-review/core';
import { generateWithClaude } from './adapters/claude.js';
import { generateWithCodex } from './adapters/codex.js';
import { generateWithCopilot } from './adapters/copilot.js';
import { generateWithCursor } from './adapters/cursor.js';
import { generateWithOpenCode } from './adapters/opencode.js';
import type { AdapterInput, AdapterResult } from './adapters/types.js';
import {
	detectCommitMessageHarnesses,
	resolveHarnessBinary,
	resolvePreferredHarness
} from './detect.js';
import { buildCommitMessagePrompt, concatenatePatches, summarizeSelections } from './prompt.js';
import { resolveCommitMessageModel } from './list-models.js';

export interface GenerateCommitMessageOptions {
	onProgress?: (text: string) => void;
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
		const status = await detectCommitMessageHarnesses();
		const harness = resolvePreferredHarness(status, request.preferredHarness);
		if (!harness) {
			return {
				ok: false,
				code: 'no-harness',
				error:
					'No supported coding agent CLI found. Install Cursor, Claude Code, Codex, Copilot, or OpenCode and try again.'
			};
		}

		const binary = await resolveHarnessBinary(harness);
		if (!binary) {
			return {
				ok: false,
				code: 'no-harness',
				error: `${harness} CLI was detected earlier but is no longer available.`
			};
		}

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

		return {
			ok: true,
			harness,
			subject: result.subject,
			body: result.body ?? ''
		};
	} finally {
		if (activeAbort === abort) activeAbort = null;
	}
}

async function runAdapter(
	harness: CommitMessageHarness,
	input: AdapterInput
): Promise<AdapterResult> {
	switch (harness) {
		case 'codex':
			return generateWithCodex(input);
		case 'claude-code':
			return generateWithClaude(input);
		case 'cursor':
			return generateWithCursor(input);
		case 'copilot':
			return generateWithCopilot(input);
		case 'opencode':
			return generateWithOpenCode(input);
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
