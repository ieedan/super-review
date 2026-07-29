import type { CommitMessageHarness } from '@super-review/core/types';

// The model each harness runs with when the user hasn't picked one, and the
// resolver over it. Kept apart from list-models.ts (which reads the on-disk
// cache, and so pulls in Electron) because generation itself needs nothing but
// this — a run can be exercised outside the app.

// Defaults when the user hasn't picked a model for that harness yet.
export const DEFAULT_COMMIT_MESSAGE_MODELS: Record<CommitMessageHarness, string> = {
	cursor: 'composer-2.5-fast',
	'claude-code': 'haiku',
	codex: 'gpt-5.6-luna',
	copilot: 'claude-haiku-4.5',
	opencode: ''
};

export function resolveCommitMessageModel(
	harness: CommitMessageHarness,
	preferred: string | null | undefined
): string {
	const trimmed = preferred?.trim();
	if (trimmed) return trimmed;
	return DEFAULT_COMMIT_MESSAGE_MODELS[harness];
}
