import type {
	CommitMessageProgressEvent,
	GenerateCommitMessageResult
} from '@super-review/core/types';

// What the CLI is allowed to do while it answers.
//   'none'       — text only. The prompt carries everything; the agent has no
//                  business reading or writing anything (commit messages).
//   'workspace'  — the repo is the input. The agent explores it and writes what
//                  it was asked to write; the prompt is the only thing keeping it
//                  to that scope, and the caller checks afterwards (changesets).
export type AdapterTools = 'none' | 'workspace';

export interface AdapterInput {
	binary: string;
	cwd: string;
	prompt: string;
	model?: string;
	tools?: AdapterTools;
	signal?: AbortSignal;
	// Fired with the accumulated reasoning and answer so the UI can stream both.
	onProgress?: (event: CommitMessageProgressEvent) => void;
	// Fired with a short line about what the agent is doing right now, whenever
	// the CLI reports a tool call ("Reading store.svelte.ts"). Only worth wiring
	// for `tools: 'workspace'` runs, where the work is the point and the answer
	// isn't.
	onActivity?: (status: string) => void;
}

export type AdapterFailureCode = NonNullable<GenerateCommitMessageResult['code']>;

// Adapters run a CLI and hand back its answer verbatim; the caller decides what
// the text is meant to be (a commit message, a report of what was written) and
// parses it. An adapter only judges whether the run produced *anything*.
export interface AdapterResult {
	ok: boolean;
	/** The raw answer text. Present whenever `ok`. */
	text?: string;
	error?: string;
	code?: AdapterFailureCode;
}
