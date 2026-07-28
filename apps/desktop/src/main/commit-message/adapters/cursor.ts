import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { parseCommitMessageOutput } from '../parse.js';
import { GENERATION_TIMEOUT_MS } from '../spawn.js';
import { createStreamReporter } from '../stream.js';
import type { AdapterInput, AdapterResult } from './types.js';

const MODEL = 'composer-2.5-fast';

// Minimal Agent Client Protocol client for Cursor's `agent acp` / `cursor-agent acp`.
// Ask mode + no FS/terminal capabilities; we collect thought + message chunk text.
export async function generateWithCursor(input: AdapterInput): Promise<AdapterResult> {
	if (input.signal?.aborted) {
		return { ok: false, code: 'cancelled', error: 'Cancelled' };
	}

	const model = input.model?.trim() || MODEL;

	let child: ChildProcessWithoutNullStreams;
	try {
		child = spawn(input.binary, ['acp'], {
			cwd: input.cwd,
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true
		});
	} catch (err) {
		return {
			ok: false,
			code: 'failed',
			error: err instanceof Error ? err.message : String(err)
		};
	}

	let nextId = 1;
	const pending = new Map<
		number,
		{ resolve: (v: unknown) => void; reject: (e: unknown) => void }
	>();
	let settled = false;
	const reporter = createStreamReporter(input.onProgress);

	const cleanup = () => {
		try {
			child.kill('SIGTERM');
		} catch {
			// ignore
		}
	};

	const timer = setTimeout(() => {
		finish({ ok: false, code: 'timeout', error: 'Timed out' });
	}, GENERATION_TIMEOUT_MS);

	const finish = (result: AdapterResult) => {
		if (settled) return;
		settled = true;
		reporter.flush();
		clearTimeout(timer);
		input.signal?.removeEventListener('abort', onAbort);
		cleanup();
		for (const [, waiter] of pending) waiter.reject(new Error('Cancelled'));
		pending.clear();
		settle(result);
	};

	const onAbort = () => {
		finish({ ok: false, code: 'cancelled', error: 'Cancelled' });
	};
	input.signal?.addEventListener('abort', onAbort, { once: true });

	let settle: (result: AdapterResult) => void = () => undefined;
	const outcome = new Promise<AdapterResult>((resolve) => {
		settle = resolve;
	});

	const send = (method: string, params: unknown): Promise<unknown> => {
		const id = nextId++;
		child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
	};

	const respond = (id: number, result: unknown) => {
		child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
	};

	child.on('error', (err) => {
		finish({ ok: false, code: 'failed', error: err.message });
	});
	child.on('close', () => {
		if (!settled) {
			finish({
				ok: false,
				code: input.signal?.aborted ? 'cancelled' : 'failed',
				error: input.signal?.aborted ? 'Cancelled' : 'Cursor ACP process exited early.'
			});
		}
	});

	const rl = readline.createInterface({ input: child.stdout });
	rl.on('line', (line) => {
		let msg: {
			id?: number;
			result?: unknown;
			error?: { message?: string };
			method?: string;
			params?: {
				update?: {
					sessionUpdate?: string;
					content?: { type?: string; text?: string };
				};
				options?: Array<{ optionId: string }>;
			};
		};
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}

		if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
			const waiter = pending.get(msg.id);
			if (!waiter) return;
			pending.delete(msg.id);
			if (msg.error) waiter.reject(new Error(msg.error.message ?? 'ACP error'));
			else waiter.resolve(msg.result);
			return;
		}

		if (msg.method === 'session/update') {
			const update = msg.params?.update;
			const kind = update?.sessionUpdate;
			const text =
				typeof update?.content?.text === 'string' ? update.content.text : undefined;
			if (!text) return;
			if (kind === 'agent_thought_chunk') {
				reporter.addThinking(text);
				return;
			}
			if (kind === 'agent_message_chunk') {
				reporter.addAnswer(text);
			}
			return;
		}

		if (msg.method === 'session/request_permission' && msg.id != null) {
			// Reject tool use — ask mode should not need tools; refuse if asked.
			const reject =
				msg.params?.options?.find((o) => o.optionId.includes('reject'))?.optionId ??
				'reject-once';
			respond(msg.id, { outcome: { outcome: 'selected', optionId: reject } });
			return;
		}

		// Cursor extension methods that block: skip / cancel so we never hang.
		if (
			msg.id != null &&
			(msg.method === 'cursor/ask_question' || msg.method === 'cursor/create_plan')
		) {
			respond(msg.id, { outcome: { outcome: 'cancelled' } });
		}
	});

	try {
		await send('initialize', {
			protocolVersion: 1,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false
			},
			clientInfo: { name: 'super-review-commit-message', version: '1.0.0' }
		});

		// Best-effort auth; already-logged-in CLIs succeed, missing login fails later.
		try {
			await send('authenticate', { methodId: 'cursor_login' });
		} catch {
			// continue — some installs authenticate via env / prior login
		}

		const session = (await send('session/new', {
			cwd: input.cwd,
			mcpServers: []
		})) as { sessionId: string };
		const sessionId = session.sessionId;

		try {
			await send('session/set_mode', { sessionId, modeId: 'ask' });
		} catch {
			// Older agents may not support set_mode; proceed with defaults.
		}

		try {
			await send('session/set_model', { sessionId, modelId: model });
		} catch {
			// Model selection is best-effort; cheap default may be unavailable.
		}

		await send('session/prompt', {
			sessionId,
			prompt: [{ type: 'text', text: input.prompt }]
		});

		const parsed = parseCommitMessageOutput(reporter.answerText());
		if (!parsed) {
			finish({
				ok: false,
				code: 'empty',
				error: 'Cursor returned no usable commit message.'
			});
		} else {
			finish({ ok: true, subject: parsed.subject, body: parsed.body });
		}
	} catch (err) {
		if (input.signal?.aborted) {
			finish({ ok: false, code: 'cancelled', error: 'Cancelled' });
		} else {
			finish({
				ok: false,
				code: 'failed',
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return outcome;
}
