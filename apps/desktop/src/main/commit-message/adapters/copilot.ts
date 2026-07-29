import { describeToolCall } from '../activity.js';
import { cliSupportsFlag } from '../cli-probe.js';
import { AGENT_TIMEOUT_MS, spawnCapture } from '../spawn.js';
import { createLineReader, createStreamReporter, type StreamReporter } from '../stream.js';
import type { AdapterInput, AdapterResult } from './types.js';

const DEFAULT_MODEL = 'claude-haiku-4.5';

export async function generateWithCopilot(input: AdapterInput): Promise<AdapterResult> {
	// A text-only run has the patch inlined already, so every tool is denied and
	// the agent can only answer. A workspace run is the opposite: it has to read
	// the repo and write what it found. --no-ask-user keeps both non-interactive.
	const agentic = input.tools === 'workspace';
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
		reportCopilotActivity(event, input.onActivity);
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
			// Nothing off-machine either way; a workspace run keeps the file and shell
			// tools it needs to look around and write the changesets.
			agentic ? '--deny-tool=url,memory' : '--deny-tool=shell,write,url,memory,read'
		],
		{
			cwd: input.cwd,
			signal: input.signal,
			timeoutMs: agentic ? AGENT_TIMEOUT_MS : undefined,
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

	// With events on stdout the assistant text only exists in what we collected;
	// stdout is the fallback for a run that streamed nothing.
	const text = streaming ? reporter.answerText().trim() || result.stdout : result.stdout;
	if (!text.trim()) {
		return {
			ok: false,
			code: result.ok ? 'empty' : 'failed',
			error: result.error ?? 'Copilot returned an empty response.'
		};
	}
	return { ok: true, text };
}

// Tool events ride the same envelope as the message ones; `data.name` is the
// tool and `data.arguments` (or `data.input`) its call.
function reportCopilotActivity(
	event: unknown,
	onActivity: ((status: string) => void) | undefined
): void {
	if (!onActivity || !event || typeof event !== 'object') return;
	const { type, data } = event as { type?: string; data?: Record<string, unknown> };
	if (!type?.startsWith('tool')) return;
	const name = typeof data?.name === 'string' ? data.name : type;
	const status = describeToolCall({ name, input: data?.arguments ?? data?.input ?? data });
	if (status) onActivity(status);
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
