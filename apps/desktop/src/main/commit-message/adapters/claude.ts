import { describeToolCall } from '../activity.js';
import { AGENT_TIMEOUT_MS, spawnCapture } from '../spawn.js';
import { createLineReader, createStreamReporter } from '../stream.js';
import type { AdapterInput, AdapterResult } from './types.js';

// Tier alias: the CLI resolves it to the newest Haiku, so it never needs bumping.
const DEFAULT_MODEL = 'haiku';
// Text-only runs get a cheap model by default; a run that has to explore a repo
// needs one that can hold a plan together, so it starts a tier up.
const DEFAULT_AGENT_MODEL = 'sonnet';

interface ClaudeResultEvent {
	is_error?: boolean;
	result?: string;
}

export async function generateWithClaude(input: AdapterInput): Promise<AdapterResult> {
	const agentic = input.tools === 'workspace';
	const model = input.model?.trim() || (agentic ? DEFAULT_AGENT_MODEL : DEFAULT_MODEL);
	const reporter = createStreamReporter(input.onProgress);

	// `--output-format json` only prints once the run is over. stream-json plus
	// --include-partial-messages gives us thinking/answer token deltas instead.
	// Held in an object so TypeScript keeps the type across the stream callback.
	const state: { result: ClaudeResultEvent | null } = { result: null };
	let sawDelta = false;

	const readLine = createLineReader((line) => {
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line) as Record<string, unknown>;
		} catch {
			return;
		}

		if (event.type === 'result') {
			state.result = event as ClaudeResultEvent;
			return;
		}

		if (event.type === 'assistant') {
			// Assistant messages carry the tool calls, whether or not deltas are on:
			// this is where "what is it doing right now" comes from.
			reportToolUse(event, input.onActivity);
			if (!sawDelta) {
				// Older CLIs (or a run without partial messages) only emit whole blocks.
				const text = collectAssistantText(event);
				if (text) reporter.setAnswer(text);
			}
			return;
		}

		if (event.type !== 'stream_event') return;
		const inner = event.event as
			| {
					type?: string;
					delta?: { type?: string; text?: string; thinking?: string };
			  }
			| undefined;
		if (inner?.type !== 'content_block_delta') return;
		const delta = inner.delta;
		if (!delta) return;

		if (delta.type === 'thinking_delta' && delta.thinking) {
			sawDelta = true;
			reporter.addThinking(delta.thinking);
			return;
		}
		if (delta.type === 'text_delta' && delta.text) {
			sawDelta = true;
			reporter.addAnswer(delta.text);
		}
	});

	try {
		const result = await spawnCapture(
			input.binary,
			[
				'-p',
				'--output-format',
				'stream-json',
				'--include-partial-messages',
				// stream-json output requires --verbose in print mode.
				'--verbose',
				'--model',
				model,
				'--dangerously-skip-permissions'
			],
			{
				cwd: input.cwd,
				stdin: input.prompt,
				signal: input.signal,
				// Exploring a repo is a different order of work than writing one
				// paragraph from a patch that's already in the prompt.
				timeoutMs: agentic ? AGENT_TIMEOUT_MS : undefined,
				onStdoutChunk: readLine
			}
		);

		if (result.cancelled) {
			return { ok: false, code: 'cancelled', error: 'Cancelled' };
		}
		if (result.timedOut) {
			return { ok: false, code: 'timeout', error: result.error ?? 'Timed out' };
		}

		const failed = state.result?.is_error === true;
		const answer = failed ? '' : (state.result?.result ?? reporter.answerText());
		if (!answer.trim()) {
			return {
				ok: false,
				code: result.ok && !failed ? 'empty' : 'failed',
				error:
					(failed ? state.result?.result : undefined) ??
					result.error ??
					'Claude returned an empty response.'
			};
		}
		return { ok: true, text: answer };
	} finally {
		reporter.flush();
	}
}

// Assistant content blocks are `{type:'tool_use', name, input}`; the last one in
// a message is the one the agent is about to do, so it wins the status line.
function reportToolUse(
	event: Record<string, unknown>,
	onActivity: ((status: string) => void) | undefined
): void {
	if (!onActivity) return;
	const message = event.message as { content?: unknown } | undefined;
	if (!Array.isArray(message?.content)) return;
	for (const block of message.content as Array<Record<string, unknown>>) {
		if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
		const status = describeToolCall({ name: block.name, input: block.input });
		if (status) onActivity(status);
	}
}

function collectAssistantText(event: Record<string, unknown>): string {
	const message = event.message as { content?: unknown } | undefined;
	const content = message?.content;
	if (!Array.isArray(content)) return '';
	const parts: string[] = [];
	for (const block of content as Array<Record<string, unknown>>) {
		if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
	}
	return parts.join('\n');
}
