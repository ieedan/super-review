import type {
	CommitMessageProgressEvent,
	GenerateCommitMessageResult
} from '@super-review/core/types';

export interface AdapterInput {
	binary: string;
	cwd: string;
	prompt: string;
	model?: string;
	signal?: AbortSignal;
	// Fired with the accumulated reasoning and answer so the UI can stream both.
	onProgress?: (event: CommitMessageProgressEvent) => void;
}

export type AdapterResult = Pick<
	GenerateCommitMessageResult,
	'ok' | 'subject' | 'body' | 'error' | 'code'
>;
