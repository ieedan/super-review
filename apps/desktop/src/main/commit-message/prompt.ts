import type { CommitFileSelection } from '@super-review/core/types';
import { DEFAULT_COMMIT_MESSAGE_BASE_PROMPT } from '@super-review/core/commit-message-prompt';

const SUMMARY_LIMIT = 6_000;
const PATCH_LIMIT = 40_000;

export { DEFAULT_COMMIT_MESSAGE_BASE_PROMPT };

// A commit message already has a wire format: subject, blank line, body. Asking
// for that instead of JSON means no harness needs a schema flag, and the reply
// reads as a commit message while it streams. This block is app-controlled and
// appended after the user's instructions and the change context.
const OUTPUT_FORMAT_SECTION = [
	'Reply with the commit message itself and nothing else:',
	'- first line: the subject, at most 72 characters, no trailing period',
	'- then one blank line, then the body (leave it out when the subject says it all)',
	'No code fences, no "Subject:"/"Body:" labels, no commentary around it.'
].join('\n');

export interface CommitMessagePromptInput {
	branch: string | null;
	fileSummary: string;
	patch: string;
	// Editable instructions without the change context. Empty/whitespace falls
	// back to DEFAULT_COMMIT_MESSAGE_BASE_PROMPT.
	basePrompt?: string | null;
}

export function buildCommitMessagePrompt(input: CommitMessagePromptInput): string {
	const base = input.basePrompt?.trim() || DEFAULT_COMMIT_MESSAGE_BASE_PROMPT;
	return [
		base,
		'',
		`Branch: ${input.branch ?? '(detached)'}`,
		'',
		'Staged files:',
		limitSection(input.fileSummary, SUMMARY_LIMIT),
		'',
		'Staged patch:',
		limitSection(input.patch, PATCH_LIMIT),
		'',
		OUTPUT_FORMAT_SECTION
	].join('\n');
}

export function summarizeSelections(selections: CommitFileSelection[]): string {
	if (selections.length === 0) return '(none)';
	return selections
		.map((s) => (s.oldPath && s.oldPath !== s.path ? `${s.oldPath} -> ${s.path}` : s.path))
		.join('\n');
}

export function concatenatePatches(selections: CommitFileSelection[]): string {
	const parts: string[] = [];
	for (const s of selections) {
		const patch = s.patch?.trim();
		if (!patch) {
			parts.push(`--- a/${s.path}\n+++ b/${s.path}\n(no patch available; file included as-is)`);
			continue;
		}
		parts.push(patch);
	}
	return parts.join('\n\n');
}

function limitSection(text: string, limit: number): string {
	if (text.length <= limit) return text || '(empty)';
	return `${text.slice(0, limit)}\n\n…(truncated)`;
}
