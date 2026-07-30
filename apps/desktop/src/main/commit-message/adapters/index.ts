import type { CommitMessageHarness } from '@super-review/core/types';
import { explainAuthFailure, looksLikeAuthFailure } from '@super-review/core/harness-auth';
import { generateWithClaude } from './claude.js';
import { generateWithCodex } from './codex.js';
import { generateWithCopilot } from './copilot.js';
import { generateWithCursor } from './cursor.js';
import { generateWithOpenCode } from './opencode.js';
import type { AdapterInput, AdapterResult } from './types.js';

// Run a prompt through one harness's CLI. What the answer is supposed to be (a
// commit message, a set of changesets) is the caller's business; an adapter
// only returns the text.
export async function runAdapter(
	harness: CommitMessageHarness,
	input: AdapterInput
): Promise<AdapterResult> {
	return classifyAuthFailure(harness, await runHarness(harness, input));
}

function runHarness(harness: CommitMessageHarness, input: AdapterInput): Promise<AdapterResult> {
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

// Re-code a signed-out failure, wherever in the five adapters it came from.
// Done here rather than per-adapter so every harness gets the same treatment
// and a new one is covered the day it's added. `cancelled` is left alone: a run
// the user aborted isn't a diagnosis.
function classifyAuthFailure(harness: CommitMessageHarness, result: AdapterResult): AdapterResult {
	if (result.ok || result.code === 'cancelled') return result;
	if (!looksLikeAuthFailure(result.error)) return result;
	return { ...result, code: 'auth', error: explainAuthFailure(harness, result.error) };
}
