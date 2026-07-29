import type { CommitMessageHarness } from '@super-review/core/types';
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
