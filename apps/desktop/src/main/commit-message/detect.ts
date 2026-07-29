import type { CommitMessageHarness, CommitMessageHarnessStatus } from '@super-review/core/types';
import { COMMIT_MESSAGE_HARNESS_PRIORITY } from '@super-review/core/types';
import { which } from './which.js';

// CLI names to probe for each harness. Cursor ships as both `cursor-agent`
// (older/t3code) and `agent` (current docs); either counts as installed.
const HARNESS_BINARIES: Record<CommitMessageHarness, readonly string[]> = {
	// Prefer `agent` (current Cursor CLI); fall back to the older `cursor-agent`.
	cursor: ['agent', 'cursor-agent'],
	'claude-code': ['claude'],
	codex: ['codex'],
	copilot: ['copilot'],
	opencode: ['opencode']
};

export async function resolveHarnessBinary(harness: CommitMessageHarness): Promise<string | null> {
	for (const name of HARNESS_BINARIES[harness]) {
		const bin = await which(name);
		if (bin) return bin;
	}
	return null;
}

export async function detectCommitMessageHarnesses(): Promise<CommitMessageHarnessStatus> {
	const status = {} as CommitMessageHarnessStatus;
	await Promise.all(
		COMMIT_MESSAGE_HARNESS_PRIORITY.map(async (harness) => {
			status[harness] = (await resolveHarnessBinary(harness)) != null;
		})
	);
	return status;
}

export function resolvePreferredHarness(
	status: CommitMessageHarnessStatus,
	preferred: CommitMessageHarness | null | undefined
): CommitMessageHarness | null {
	if (preferred && status[preferred]) return preferred;
	for (const harness of COMMIT_MESSAGE_HARNESS_PRIORITY) {
		if (status[harness]) return harness;
	}
	return null;
}
