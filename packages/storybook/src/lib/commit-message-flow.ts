/**
 * Harness for the "generate a commit message" flow.
 *
 * The real flow is: the sparkle button calls `actions.generateCommitMessage()`,
 * that calls `window.api.commitMessage.generate()` in the main process, and the
 * harness CLI streams reasoning and answer tokens back as
 * `commitMessage:progress` events until it resolves with a subject and body. The
 * answer is painted into the commit box as it arrives.
 *
 * Storybook has no main process, so this module stands in for it: it installs a
 * `window.api.commitMessage` that replays a scripted response with real delays,
 * so the box goes through exactly the states it does against a live CLI —
 * including the long silence before the first token, and the size of the chunks
 * that break it (see CHUNK_CHARS, which is the whole reason the box paces the
 * answer back out rather than painting what arrives).
 */
import { app } from '@super-review/ui/store.svelte';
import type { CommitMessageHarness } from '@super-review/core/types';
import { harnessStatus } from './store-harness';

export interface MockResponse {
	/** What the model "reasons" about before it answers (streamed first). */
	reasoning: string;
	subject: string;
	body: string;
}

export interface MockTiming {
	/** Silence before the first token — what the waiting state covers. */
	startupMs: number;
	/** Delay between streamed chunks. */
	chunkMs: number;
}

/**
 * How much text a chunk carries.
 *
 * Not a token, and not a word: no harness CLI reports at that granularity. A
 * measured `claude -p --include-partial-messages` run answered a 434 character
 * message in six deltas ~140ms apart, the first of which already held the whole
 * subject line, and the reporter in main coalesces further still. Streaming this
 * word by word made the box look like it typed when it does not — the commit box
 * paces the answer back out itself (see `stepReveal`), and this is the input
 * that has to be realistic for that to be worth anything.
 */
const CHUNK_CHARS = 60;

export const DEFAULT_RESPONSE: MockResponse = {
	reasoning:
		'Reading the staged patch. It adds createStreamReporter, a throttled progress emitter shared by every harness adapter, so the commit box can show tokens as they arrive.',
	subject: 'feat: stream harness output into the commit box',
	body: '- share a throttled progress reporter across adapters\n- render partial output while the model is still writing'
};

export const DEFAULT_TIMING: MockTiming = { startupMs: 2500, chunkMs: 140 };

/**
 * OpenCode's listing, in the shape the CLI returns it: `<provider>/<model>` for
 * a direct provider and `<provider>/<lab>/<model>` through a router, ranked
 * cheapest-first. Exported so stories seed the same list the picker groups.
 */
export const OPENCODE_MODELS: { id: string; label: string }[] = [
	'opencode/deepseek-v4-flash-free',
	'opencode/ling-3.0-flash-free',
	'opencode/north-mini-code-free',
	'opencode/big-pickle',
	'opencode/laguna-s-2.1-free',
	'openrouter/google/lyria-3-clip-preview',
	'openrouter/qwen/qwen3-coder',
	'openrouter/deepseek/deepseek-v3.2',
	'anthropic/claude-haiku-4-5',
	'anthropic/claude-sonnet-4-5',
	'openai/gpt-5-mini',
	'openai/gpt-5.1-codex'
].map((id) => ({ id, label: id }));

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
	generating: boolean;
	/** What the model has said so far, split the way the box splits it. */
	reasoning: string;
	answer: string;
	/** The commit box contents once the message has been applied. */
	applied: { subject: string; body: string } | null;
}

export function buildFlowSteps(response: MockResponse): FlowStep[] {
	const subjectHalf = clipWords(response.subject, 0.6);
	const bodyHalf = clipWords(response.body, 0.5);
	const answer = message(response);

	return [
		{
			label: 'Idle',
			note: 'The sparkle sits in the Summary field. One click runs it — there is nothing to configure here, that lives in Settings → Agents. With no agent CLI installed the button is not rendered at all.',
			generating: false,
			reasoning: '',
			answer: '',
			applied: null
		},
		{
			label: 'Waiting on the CLI',
			note: 'The run started: the sparkle shimmers and Summary says what is happening. The agent has not said anything yet — CLIs can sit silent here for many seconds.',
			generating: true,
			reasoning: '',
			answer: '',
			applied: null
		},
		{
			label: 'Reasoning (not shown)',
			note: 'The model thinks out loud first. That channel is kept apart from the answer and deliberately never reaches the box — Summary still shows the waiting state.',
			generating: true,
			reasoning: response.reasoning,
			answer: '',
			applied: null
		},
		{
			label: 'Subject streams',
			note: 'The answer starts writing into Summary. What arrived was a whole slab of text — the box walks through it rather than painting it — and the field is read-only while it does, so nothing collides.',
			generating: true,
			reasoning: response.reasoning,
			answer: subjectHalf,
			applied: null
		},
		{
			label: 'Body starts',
			note: 'A blank line ends the subject; everything after it goes to Description.',
			generating: true,
			reasoning: response.reasoning,
			answer: `${response.subject}\n\n${bodyHalf}`,
			applied: null
		},
		{
			label: 'Body streams',
			note: 'The last frame before the run resolves. What is painted here is exactly what will be committed.',
			generating: true,
			reasoning: response.reasoning,
			answer,
			applied: null
		},
		{
			label: 'Applied',
			note: 'The run resolves: the painted text becomes the real field values and focus moves to Commit. A cancel instead would leave the box exactly as it was.',
			generating: false,
			reasoning: '',
			answer: '',
			applied: { subject: response.subject, body: response.body }
		}
	];
}

/** Push a step's snapshot into the store fields the commit box reads. */
export function applyFlowStep(step: FlowStep): void {
	app.commitMessageGenerating = step.generating;
	app.commitMessageReasoning = step.reasoning;
	app.commitMessageAnswer = step.answer;
}

function clipWords(text: string, fraction: number): string {
	const words = text.split(' ');
	const take = Math.max(1, Math.round(words.length * fraction));
	return words.slice(0, take).join(' ');
}

// ─── Mock main process ──────────────────────────────────────────────────────

type ProgressListener = (event: { reasoning: string; answer: string }) => void;

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

	// Storybook's blanket api stub resolves setPrefs to undefined, which the store
	// then writes over `app.prefs` — wiping the seeded harness the moment the model
	// picker saves a default. Merge instead, the way main does.
	const state = new Proxy(
		{},
		{
			get(_t, prop) {
				if (prop !== 'setPrefs') return base?.state?.[prop];
				return async (patch: Record<string, unknown>) => {
					app.prefs = { ...(app.prefs ?? {}), ...patch };
					return app.prefs;
				};
			}
		}
	);

	w.api = new Proxy(base ?? {}, {
		get(target, prop) {
			if (prop === 'commitMessage') return commitMessageMock;
			if (prop === 'events') return events;
			if (prop === 'state') return state;
			return Reflect.get(target, prop);
		}
	});
}

const commitMessageMock = {
	async detect() {
		return harnessStatus(['cursor', 'claude-code', 'codex', 'copilot', 'opencode']);
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
		channels.reasoning = '';
		channels.answer = '';
		const { response, timing } = script;

		// The silence the waiting state exists for.
		if (await sleep(timing.startupMs)) return CANCELLED;

		if (await streamChannel('reasoning', response.reasoning, timing.chunkMs)) return CANCELLED;
		if (await streamChannel('answer', message(response), timing.chunkMs)) return CANCELLED;

		return { ok: true, harness: 'claude-code', subject: response.subject, body: response.body };
	}
};

const CANCELLED = { ok: false, code: 'cancelled', error: 'Cancelled' };

// Emit progress the way the main process does: each channel accumulates and the
// whole pair is sent every time, chunk by chunk.
const channels = { reasoning: '', answer: '' };

async function streamChannel(
	channel: 'reasoning' | 'answer',
	text: string,
	chunkMs: number
): Promise<boolean> {
	for (const chunk of slabs(text)) {
		channels[channel] += chunk;
		emit();
		if (await sleep(chunkMs)) return true;
	}
	return false;
}

/** Cut text into CLI-sized chunks, breaking on a word so the seams look real. */
function slabs(text: string): string[] {
	const out: string[] = [];
	let rest = text;
	while (rest.length > CHUNK_CHARS) {
		const window = rest.slice(0, CHUNK_CHARS);
		// No space in the window means one very long word — send it whole.
		const cut = window.lastIndexOf(' ') + 1 || CHUNK_CHARS;
		out.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	if (rest) out.push(rest);
	return out;
}

function emit(): void {
	const event = { reasoning: channels.reasoning.trim(), answer: channels.answer.trim() };
	if (listeners.size > 0) {
		for (const listener of listeners) listener(event);
		return;
	}
	// The store subscribes once per session; if something subscribed before this
	// mock was installed, write the fields the listener would have written.
	app.commitMessageReasoning = event.reasoning;
	app.commitMessageAnswer = event.answer;
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
	// OpenCode lists every authenticated provider at once, so the fixture keeps
	// that shape (free zero-cost models first, then routers, then paid providers).
	opencode: OPENCODE_MODELS
};
