// `codex exec` renders the answer only once the turn is over — its event stream
// carries whole items, never token deltas (both with and without --json). The
// app-server protocol does emit deltas, so that is what we drive for streaming,
// falling back to `codex exec` when the handshake doesn't work out.
//
// Protocol: newline-delimited JSON-RPC over stdio, without the "jsonrpc" field.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import type { StreamReporter } from './stream.js';

// The handshake is local work (spawn, initialize, thread/start): if it hasn't
// finished by now the app-server isn't usable and we fall back.
const HANDSHAKE_TIMEOUT_MS = 15_000;

export interface CodexTurnResult {
	ok: boolean;
	text: string;
	error?: string;
	cancelled?: boolean;
	timedOut?: boolean;
	/** The app-server can't be driven; the caller should use `codex exec`. */
	unavailable?: boolean;
}

export interface CodexTurnOptions {
	binary: string;
	cwd: string;
	prompt: string;
	model?: string;
	/** JSON Schema constraining the final assistant message for this turn. */
	outputSchema?: unknown;
	timeoutMs: number;
	signal?: AbortSignal;
	reporter: StreamReporter;
}

export async function runCodexAppServerTurn(opts: CodexTurnOptions): Promise<CodexTurnResult> {
	if (opts.signal?.aborted) {
		return { ok: false, text: '', cancelled: true, error: 'Cancelled' };
	}

	let child: ChildProcessWithoutNullStreams;
	try {
		child = spawn(opts.binary, ['app-server'], {
			cwd: opts.cwd,
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true
		});
	} catch {
		return { ok: false, text: '', unavailable: true };
	}

	let nextId = 1;
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	let settled = false;
	let settle: (result: CodexTurnResult) => void = () => undefined;
	const outcome = new Promise<CodexTurnResult>((resolve) => {
		settle = resolve;
	});

	// Filled from item/completed so a delta stream we mis-parse can't lose the
	// answer; deltas are only what the user watches while it is being written.
	let finalText = '';
	let streamedText = '';

	const kill = () => {
		try {
			child.kill('SIGTERM');
		} catch {
			// ignore
		}
	};

	const finish = (result: CodexTurnResult) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onAbort);
		kill();
		for (const [, waiter] of pending) waiter.reject(new Error('Cancelled'));
		pending.clear();
		settle(result);
	};

	const onAbort = () => finish({ ok: false, text: '', cancelled: true, error: 'Cancelled' });
	opts.signal?.addEventListener('abort', onAbort, { once: true });

	const timer = setTimeout(
		() => finish({ ok: false, text: '', timedOut: true, error: 'Timed out' }),
		opts.timeoutMs
	);

	const write = (payload: unknown) => {
		child.stdin.write(`${JSON.stringify(payload)}\n`);
	};

	const request = (method: string, params: unknown): Promise<unknown> => {
		const id = nextId++;
		write({ method, id, params });
		return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
	};

	const notify = (method: string, params: unknown) => write({ method, params });

	child.on('error', () => finish({ ok: false, text: '', unavailable: true }));
	child.on('close', () => {
		// Exiting before the turn resolved means the protocol didn't work out.
		finish({ ok: false, text: '', unavailable: true });
	});
	// Codex logs to stderr; drain it so a full pipe can't stall the process.
	child.stderr.resume();

	const rl = readline.createInterface({ input: child.stdout });
	rl.on('line', (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		let message: {
			id?: number;
			result?: unknown;
			error?: { message?: string };
			method?: string;
			params?: Record<string, unknown>;
		};
		try {
			message = JSON.parse(trimmed);
		} catch {
			return;
		}

		if (message.id != null && (message.result !== undefined || message.error !== undefined)) {
			const waiter = pending.get(message.id);
			if (!waiter) return;
			pending.delete(message.id);
			if (message.error) waiter.reject(new Error(message.error.message ?? 'Codex error'));
			else waiter.resolve(message.result);
			return;
		}

		if (!message.method) return;
		const params = message.params ?? {};

		switch (message.method) {
			case 'item/agentMessage/delta': {
				const delta = typeof params.delta === 'string' ? params.delta : '';
				streamedText += delta;
				opts.reporter.addAnswer(delta);
				return;
			}
			case 'item/reasoning/delta': {
				const delta = typeof params.delta === 'string' ? params.delta : '';
				opts.reporter.addThinking(delta);
				return;
			}
			case 'item/completed': {
				const item = params.item as
					| { type?: string; item_type?: string; text?: string }
					| undefined;
				if (!item) return;
				const kind = item.item_type ?? item.type;
				if (kind === 'agent_message' && typeof item.text === 'string') {
					finalText = item.text;
					opts.reporter.setAnswer(item.text);
				}
				return;
			}
			case 'turn/completed': {
				const turn = params.turn as { items?: Array<Record<string, unknown>> } | undefined;
				if (!finalText) finalText = collectAgentMessage(turn?.items) || streamedText;
				finish({ ok: true, text: finalText });
				return;
			}
			case 'turn/failed': {
				const error = params.error as { message?: string } | undefined;
				finish({
					ok: false,
					text: finalText || streamedText,
					error: error?.message ?? 'Codex turn failed.'
				});
				return;
			}
			default:
				return;
		}
	});

	try {
		await withTimeout(
			(async () => {
				await request('initialize', {
					clientInfo: {
						name: 'super-review',
						title: 'Super Review',
						version: '1.0.0'
					},
					capabilities: { experimentalApi: true }
				});
				notify('initialized', {});

				const thread = (await request('thread/start', {
					model: opts.model,
					cwd: opts.cwd,
					approvalPolicy: 'never',
					sandbox: 'readOnly'
				})) as { thread?: { id?: string }; threadId?: string; id?: string };

				const threadId = thread?.thread?.id ?? thread?.threadId ?? thread?.id;
				if (!threadId) throw new Error('No thread id');

				await request('turn/start', {
					threadId,
					input: [{ type: 'text', text: opts.prompt }],
					cwd: opts.cwd,
					model: opts.model,
					effort: 'low',
					// Same contract as `exec --output-schema`, so the JSON shape never
					// has to be spelled out in the prompt.
					...(opts.outputSchema ? { outputSchema: opts.outputSchema } : {})
				});
			})(),
			HANDSHAKE_TIMEOUT_MS
		);
	} catch {
		if (opts.signal?.aborted) {
			finish({ ok: false, text: '', cancelled: true, error: 'Cancelled' });
		} else {
			finish({ ok: false, text: '', unavailable: true });
		}
	}

	return outcome;
}

function collectAgentMessage(items: Array<Record<string, unknown>> | undefined): string {
	if (!Array.isArray(items)) return '';
	const texts: string[] = [];
	for (const item of items) {
		const kind = (item.item_type ?? item.type) as string | undefined;
		if (kind === 'agent_message' && typeof item.text === 'string') texts.push(item.text);
	}
	return texts.join('\n');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Timed out')), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}
