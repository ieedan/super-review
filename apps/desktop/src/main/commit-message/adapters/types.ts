import type { GenerateCommitMessageResult } from '@super-review/core/types';

export interface AdapterInput {
	binary: string;
	cwd: string;
	prompt: string;
	model?: string;
	signal?: AbortSignal;
	// Fired with accumulated output so the UI can stream progress.
	onProgress?: (text: string) => void;
}

export type AdapterResult = Pick<
	GenerateCommitMessageResult,
	'ok' | 'subject' | 'body' | 'error' | 'code'
>;
