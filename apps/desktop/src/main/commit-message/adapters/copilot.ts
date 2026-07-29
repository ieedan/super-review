import { cliSupportsFlag } from '../cli-probe.js';
import { parseCommitMessageOutput } from '../parse.js';
import { spawnCapture } from '../spawn.js';
import { createLineReader, createStreamReporter, type StreamReporter } from '../stream.js';
import type { AdapterInput, AdapterResult } from './types.js';

const DEFAULT_MODEL = 'claude-haiku-4.5';

export async function generateWithCopilot(input: AdapterInput): Promise<AdapterResult> {
	// Patch is already inlined in the prompt; deny every tool so the agent can
	// only return text. --no-ask-user keeps it non-interactive.
	const model = input.model?.trim() || DEFAULT_MODEL;
	const reporter = createStreamReporter(input.onProgress);

	// In plain mode the CLI renders to its TUI buffer and stdout only gets the
	// final answer. `--output-format json` emits the session event stream as
	// JSONL, which includes assistant message deltas.
	const streaming = await cliSupportsFlag(input.binary, ['--help'], '--output-format', input.cwd);
	const readLine = createLineReader((line) => {
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		applyCopilotEvent(event, reporter);
	});

	const result = await spawnCapture(
		input.binary,
		[
			'-p',
			input.prompt,
			...(streaming ? ['--output-format', 'json'] : ['-s']),
			'--model',
			model,
			'--no-ask-user',
			'--deny-tool=shell,write,url,memory,read'
		],
		{
			cwd: input.cwd,
			signal: input.signal,
			...(streaming
				? { onStdoutChunk: readLine }
				: { onStdout: (stdout) => reporter.setAnswer(stdout) })
		}
	);
	reporter.flush();

	if (result.cancelled) {
		return { ok: false, code: 'cancelled', error: 'Cancelled' };
	}
	if (result.timedOut) {
		return { ok: false, code: 'timeout', error: result.error ?? 'Timed out' };
	}

	// With events on stdout the assistant text only exists in what we collected.
	const parsed = streaming
		? (parseCommitMessageOutput(reporter.answerText()) ?? parseCommitMessageOutput(result.stdout))
		: parseCommitMessageOutput(result.stdout);
	if (!parsed) {
		return {
			ok: false,
			code: result.ok ? 'empty' : 'failed',
			error: result.error ?? 'Copilot returned no usable commit message.'
		};
	}
	return { ok: true, subject: parsed.subject, body: parsed.body };
}

// Session events share an `{ type, data }` envelope. Deltas are ephemeral and
// only present when the CLI streams; the persisted `assistant.message` /
// `assistant.reasoning` events carry the complete text either way.
function applyCopilotEvent(event: unknown, reporter: StreamReporter): void {
	if (!event || typeof event !== 'object') return;
	const { type, data } = event as { type?: string; data?: Record<string, unknown> };
	if (!type) return;
	const payload = data ?? {};
	const delta = typeof payload.deltaContent === 'string' ? payload.deltaContent : '';
	const content = typeof payload.content === 'string' ? payload.content : '';

	switch (type) {
		case 'assistant.message_delta':
			reporter.addAnswer(delta);
			return;
		case 'assistant.message':
			if (content) reporter.setAnswer(content);
			return;
		case 'assistant.reasoning_delta':
			reporter.addThinking(delta);
			return;
		case 'assistant.reasoning':
			if (content) reporter.setThinking(content);
			return;
		default:
			return;
	}
}
