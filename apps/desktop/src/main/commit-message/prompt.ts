import type { CommitFileSelection } from '@super-review/core/types';

const SUMMARY_LIMIT = 6_000;
const PATCH_LIMIT = 40_000;

export const COMMIT_MESSAGE_JSON_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['subject', 'body'],
	properties: {
		subject: { type: 'string' },
		body: { type: 'string' }
	}
} as const;

export interface CommitMessagePromptInput {
	branch: string | null;
	fileSummary: string;
	patch: string;
}

export function buildCommitMessagePrompt(input: CommitMessagePromptInput): string {
	return [
		'You write concise git commit messages.',
		'Return a JSON object with keys: subject, body.',
		'Rules:',
		'- subject must be imperative, <= 72 chars, and no trailing period',
		'- body can be empty string or short bullet points',
		'- capture the primary user-visible or developer-visible change',
		'- return ONLY the JSON object, no markdown fences or commentary',
		'',
		`Branch: ${input.branch ?? '(detached)'}`,
		'',
		'Staged files:',
		limitSection(input.fileSummary, SUMMARY_LIMIT),
		'',
		'Staged patch:',
		limitSection(input.patch, PATCH_LIMIT)
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
