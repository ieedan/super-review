import type { GenerateCommitMessageResult } from '@super-review/core/types';

export interface AdapterInput {
	binary: string;
	cwd: string;
	prompt: string;
}

export type AdapterResult = Pick<
	GenerateCommitMessageResult,
	'ok' | 'subject' | 'body' | 'error' | 'code'
>;
