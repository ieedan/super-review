import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describeToolCall } from '../activity.js';
import { cliSupportsFlag } from '../cli-probe.js';
import { runCodexAppServerTurn } from '../codex-app-server.js';
import { AGENT_TIMEOUT_MS, GENERATION_TIMEOUT_MS, spawnCapture } from '../spawn.js';
import { createLineReader, createStreamReporter, type StreamReporter } from '../stream.js';
import type { AdapterInput, AdapterResult } from './types.js';

const DEFAULT_MODEL = 'gpt-5.6-luna';

export async function generateWithCodex(input: AdapterInput): Promise<AdapterResult> {
	const model = input.model?.trim() || DEFAULT_MODEL;
	const reporter = createStreamReporter(input.onProgress);

	try {
		// The app-server exists to stream an answer token by token. A run that goes
		// off and works in the repo has no answer worth streaming (the output is the
		// files it writes) and needs a sandbox `exec` is the one that configures, so
		// it skips straight there.
		if (input.tools === 'workspace') {
			return await generateWithCodexExec(input, model, reporter);
		}

		// `codex exec` only prints the answer when the turn is over — its event
		// stream has no deltas. The app-server does stream, so try it first.
		const streamed = await runCodexAppServerTurn({
			binary: input.binary,
			cwd: input.cwd,
			prompt: input.prompt,
			model,
			timeoutMs: GENERATION_TIMEOUT_MS,
			signal: input.signal,
			reporter
		});

		if (streamed.cancelled) return { ok: false, code: 'cancelled', error: 'Cancelled' };
		if (streamed.timedOut) {
			return { ok: false, code: 'timeout', error: streamed.error ?? 'Timed out' };
		}
		if (!streamed.unavailable) {
			if (streamed.text.trim()) return { ok: true, text: streamed.text };
			if (streamed.error) {
				return { ok: false, code: 'failed', error: streamed.error };
			}
			// Turn finished but said nothing: fall through and let `exec` have one go
			// rather than failing outright.
		}

		return await generateWithCodexExec(input, model, reporter);
	} finally {
		reporter.flush();
	}
}

// Fallback: one-shot run. Streams whatever the event feed gives us (reasoning
// and message items as they complete), which is all `exec` offers.
async function generateWithCodexExec(
	input: AdapterInput,
	model: string,
	reporter: StreamReporter
): Promise<AdapterResult> {
	const dir = await mkdtemp(path.join(tmpdir(), 'sr-codex-'));
	const outputPath = path.join(dir, 'last-message.txt');
	try {
		const streaming = await cliSupportsFlag(input.binary, ['exec', '--help'], '--json', input.cwd);
		const readLine = createLineReader((line) => {
			let event: unknown;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			applyCodexEvent(event, reporter);
			reportCodexActivity(event, input.onActivity);
		});

		const agentic = input.tools === 'workspace';
		const result = await spawnCapture(
			input.binary,
			[
				'exec',
				'--ephemeral',
				'--skip-git-repo-check',
				'-s',
				// Writing changesets means writing files; anything else stays read-only.
				agentic ? 'workspace-write' : 'read-only',
				'--model',
				model,
				'--config',
				`model_reasoning_effort="${agentic ? 'medium' : 'low'}"`,
				'--output-last-message',
				outputPath,
				...(streaming ? ['--json'] : []),
				'-'
			],
			{
				cwd: input.cwd,
				stdin: input.prompt,
				signal: input.signal,
				timeoutMs: agentic ? AGENT_TIMEOUT_MS : undefined,
				...(streaming
					? { onStdoutChunk: readLine }
					: { onStdout: (stdout) => reporter.setAnswer(stdout) })
			}
		);

		if (result.cancelled) {
			return { ok: false, code: 'cancelled', error: 'Cancelled' };
		}
		if (result.timedOut) {
			return { ok: false, code: 'timeout', error: result.error ?? 'Timed out' };
		}

		let raw = '';
		try {
			raw = await readFile(outputPath, 'utf8');
		} catch {
			// --json turns stdout into events, so the streamed answer is the fallback.
			raw = streaming ? reporter.answerText() : result.stdout;
		}

		if (!raw.trim()) {
			return {
				ok: false,
				code: 'empty',
				error: result.error ?? 'Codex returned an empty response.'
			};
		}
		return { ok: true, text: raw };
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

// Codex reports its work as thread items (`command_execution`, `file_change`) or
// as `exec_command_begin`-style messages, depending on the CLI version. Both
// carry enough to say what it is doing.
function reportCodexActivity(
	event: unknown,
	onActivity: ((status: string) => void) | undefined
): void {
	if (!onActivity || !event || typeof event !== 'object') return;
	const outer = event as Record<string, unknown>;

	const item = outer.item as Record<string, unknown> | undefined;
	if (item && typeof item === 'object') {
		const kind = (item.item_type ?? item.type) as string | undefined;
		if (!kind) return;
		const status = describeToolCall({ name: kind, input: item });
		if (status) onActivity(status);
		return;
	}

	const msg = (outer.msg && typeof outer.msg === 'object' ? outer.msg : outer) as Record<
		string,
		unknown
	>;
	const type = typeof msg.type === 'string' ? msg.type : '';
	if (!type.endsWith('_begin')) return;
	const status = describeToolCall({ name: type.replace(/_begin$/, ''), input: msg });
	if (status) onActivity(status);
}

// Codex has shipped a few event schemas: `{msg:{type:'agent_message_delta'}}`,
// bare `{type:'agent_message_delta'}`, and thread items (`item.completed` with an
// `agent_message`/`reasoning` item). Handle all of them and ignore the rest.
function applyCodexEvent(event: unknown, reporter: StreamReporter): void {
	if (!event || typeof event !== 'object') return;
	const outer = event as Record<string, unknown>;

	const item = outer.item as Record<string, unknown> | undefined;
	if (item && typeof item === 'object') {
		const kind = (item.item_type ?? item.type) as string | undefined;
		const text = typeof item.text === 'string' ? item.text : undefined;
		if (!text) return;
		if (kind === 'reasoning') reporter.setThinking(text);
		else if (kind === 'agent_message') reporter.setAnswer(text);
		return;
	}

	const msg = (outer.msg && typeof outer.msg === 'object' ? outer.msg : outer) as Record<
		string,
		unknown
	>;
	const type = typeof msg.type === 'string' ? msg.type : '';
	const delta = typeof msg.delta === 'string' ? msg.delta : '';

	switch (type) {
		case 'agent_message_delta':
			reporter.addAnswer(delta);
			return;
		case 'agent_reasoning_delta':
		case 'agent_reasoning_raw_content_delta':
			reporter.addThinking(delta);
			return;
		case 'agent_message':
			if (typeof msg.message === 'string') reporter.setAnswer(msg.message);
			return;
		case 'agent_reasoning':
			if (typeof msg.text === 'string') reporter.setThinking(msg.text);
			return;
		default:
			return;
	}
}
