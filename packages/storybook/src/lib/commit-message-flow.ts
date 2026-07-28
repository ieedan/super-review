/**
 * Harness for the "generate a commit message" flow.
 *
 * The real flow is: the sparkle button opens the popover, the popover calls
 * `actions.generateCommitMessage()`, that calls `window.api.commitMessage.generate()`
 * in the main process, and the harness CLI streams reasoning/answer tokens back
 * as `commitMessage:progress` events until it resolves with a subject and body.
 *
 * Storybook has no main process, so this module stands in for it: it installs a
 * `window.api.commitMessage` that replays a scripted response with real delays,
 * so the popover goes through exactly the states it does against a live CLI —
 * including the long silence before the first token.
 */
import { app } from '@super-review/ui/store.svelte';
import type { CommitMessageHarness } from '@super-review/core/types';

export interface MockResponse {
	/** What the model "reasons" about before it answers (streamed first). */
	reasoning: string;
	subject: string;
	body: string;
}

export interface MockTiming {
	/** Silence before the first token — what the "Thinking…" state covers. */
	startupMs: number;
	/** Delay between streamed chunks. */
	chunkMs: number;
}

export const DEFAULT_RESPONSE: MockResponse = {
	reasoning:
		'Reading the staged patch. It adds createStreamReporter, a throttled progress emitter shared by every harness adapter, so the commit box can show tokens as they arrive.',
	subject: 'feat: stream harness output into the commit box',
	body: '- share a throttled progress reporter across adapters\n- render partial output while the model is still writing'
};

export const DEFAULT_TIMING: MockTiming = { startupMs: 2500, chunkMs: 45 };

/** The full text the popover shows at the end of a run. */
export function fullStream(response: MockResponse): string {
	return [response.reasoning, message(response)].filter(Boolean).join('\n\n');
}

function message(response: MockResponse): string {
	return [response.subject, response.body].filter(Boolean).join('\n\n');
}

// ─── Scripted steps ─────────────────────────────────────────────────────────
// Every step is an absolute snapshot, never a delta, so the stepper story can
// jump backwards as freely as it goes forwards.

export interface FlowStep {
	label: string;
	/** What to look at while this step is on screen. */
	note: string;
	popoverOpen: boolean;
	generating: boolean;
	stream: string;
	/** The commit box contents once the message has been applied. */
	applied: { subject: string; body: string } | null;
}

export function buildFlowSteps(response: MockResponse): FlowStep[] {
	const reasoningHalf = clipWords(response.reasoning, 0.45);
	const subjectHalf = clipWords(response.subject, 0.6);

	return [
		{
			label: 'Idle',
			note: 'The sparkle sits in the Summary field. Hovering it opens the popover after 200ms; shift-clicking skips straight to generating.',
			popoverOpen: false,
			generating: false,
			stream: '',
			applied: null
		},
		{
			label: 'Popover open',
			note: 'Harness split button (the chevron switches CLI), model picker, and the editable prompt. Enter in the prompt generates.',
			popoverOpen: true,
			generating: false,
			stream: '',
			applied: null
		},
		{
			label: 'Waiting on the CLI',
			note: 'No output yet: the harness logo with a shimmering "Thinking…". CLIs can sit silent here for many seconds.',
			popoverOpen: true,
			generating: true,
			stream: '',
			applied: null
		},
		{
			label: 'Reasoning starts',
			note: 'First tokens. Reasoning streams before the answer and the box scrolls to follow it.',
			popoverOpen: true,
			generating: true,
			stream: reasoningHalf,
			applied: null
		},
		{
			label: 'Reasoning done',
			note: 'The model has finished thinking; the answer has not started.',
			popoverOpen: true,
			generating: true,
			stream: response.reasoning,
			applied: null
		},
		{
			label: 'Subject streams',
			note: 'The answer is the commit message itself — subject first, no JSON to decode.',
			popoverOpen: true,
			generating: true,
			stream: `${response.reasoning}\n\n${subjectHalf}`,
			applied: null
		},
		{
			label: 'Body streams',
			note: 'Blank line, then the body. This is the last frame before the run resolves.',
			popoverOpen: true,
			generating: true,
			stream: fullStream(response),
			applied: null
		},
		{
			label: 'Applied',
			note: 'The run resolves, the popover closes, and subject/body land in the commit box.',
			popoverOpen: false,
			generating: false,
			stream: '',
			applied: { subject: response.subject, body: response.body }
		}
	];
}

/** Push a step's snapshot into the store fields the popover reads. */
export function applyFlowStep(step: FlowStep): void {
	app.commitMessageGenerating = step.generating;
	app.commitMessageStream = step.stream;
}

function clipWords(text: string, fraction: number): string {
	const words = text.split(' ');
	const take = Math.max(1, Math.round(words.length * fraction));
	return words.slice(0, take).join(' ');
}

// ─── Mock main process ──────────────────────────────────────────────────────

type ProgressListener = (event: { text: string }) => void;

const listeners = new Set<ProgressListener>();
let installed = false;
let cancelled = false;
let script: { response: MockResponse; timing: MockTiming } = {
	response: DEFAULT_RESPONSE,
	timing: DEFAULT_TIMING
};

/** Swap what the mocked CLI replies with (wired to the story's args). */
export function setMockScript(response: MockResponse, timing: MockTiming): void {
	script = { response, timing };
}

export function installCommitMessageMock(): void {
	if (installed || typeof window === 'undefined') return;
	installed = true;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as any;
	const base = w.api;
	const events = new Proxy(
		{},
		{
			get(_t, prop) {
				if (prop === 'onCommitMessageProgress') {
					return (cb: ProgressListener) => {
						listeners.add(cb);
						return () => listeners.delete(cb);
					};
				}
				return base?.events?.[prop];
			}
		}
	);

	w.api = new Proxy(base ?? {}, {
		get(target, prop) {
			if (prop === 'commitMessage') return commitMessageMock;
			if (prop === 'events') return events;
			return Reflect.get(target, prop);
		}
	});
}

const commitMessageMock = {
	async detect() {
		return { cursor: true, 'claude-code': true, codex: true, copilot: true, opencode: true };
	},
	async listModels(harness: CommitMessageHarness) {
		return MODELS[harness] ?? [];
	},
	async cancel() {
		cancelled = true;
		return true;
	},
	async generate() {
		cancelled = false;
		const { response, timing } = script;

		// The silence the "Thinking…" state exists for.
		if (await sleep(timing.startupMs)) return CANCELLED;

		if (await streamText(response.reasoning, '', timing.chunkMs)) return CANCELLED;
		const afterReasoning = response.reasoning ? `${response.reasoning}\n\n` : '';
		if (await streamText(message(response), afterReasoning, timing.chunkMs)) return CANCELLED;

		return { ok: true, harness: 'claude-code', subject: response.subject, body: response.body };
	}
};

const CANCELLED = { ok: false, code: 'cancelled', error: 'Cancelled' };

// Emit progress the way the main process does: cumulative text, chunk by chunk.
async function streamText(text: string, prefix: string, chunkMs: number): Promise<boolean> {
	let sent = '';
	for (const chunk of text.match(/\S+\s*/g) ?? []) {
		sent += chunk;
		emit(prefix + sent);
		if (await sleep(chunkMs)) return true;
	}
	return false;
}

function emit(text: string): void {
	if (listeners.size > 0) {
		for (const listener of listeners) listener({ text });
		return;
	}
	// The store subscribes once per session; if something subscribed before this
	// mock was installed, write the field the listener would have written.
	app.commitMessageStream = text;
}

/** Resolves true when the run was cancelled while waiting. */
function sleep(ms: number): Promise<boolean> {
	return new Promise((resolve) => setTimeout(() => resolve(cancelled), ms));
}

const MODELS: Record<CommitMessageHarness, { id: string; label: string }[]> = {
	'claude-code': [
		{ id: 'haiku', label: 'Haiku' },
		{ id: 'sonnet', label: 'Sonnet' },
		{ id: 'opus', label: 'Opus' }
	],
	cursor: [
		{ id: 'composer-2.5-fast', label: 'Composer 2.5 Fast' },
		{ id: 'composer-2.5', label: 'Composer 2.5' }
	],
	codex: [
		{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
		{ id: 'gpt-5.3-codex', label: 'Codex 5.3' }
	],
	copilot: [
		{ id: 'claude-haiku-4.5', label: 'Haiku 4.5' },
		{ id: 'gpt-5-mini', label: 'GPT-5 mini' }
	],
	opencode: [{ id: 'opencode/grok-code', label: 'opencode/grok-code' }]
};
