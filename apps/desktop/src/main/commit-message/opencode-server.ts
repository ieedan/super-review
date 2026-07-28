// `opencode run` prints the answer in one lump when the run finishes, so it can
// never drive a streaming UI. The headless server does emit token deltas over
// SSE, so we boot one for the duration of a generation and talk to it directly.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { StreamReporter } from './stream.js';

const STARTUP_TIMEOUT_MS = 20_000;

export interface OpenCodeServer {
	url: string;
	headers: Record<string, string>;
	close(): void;
}

export interface OpenCodeReply {
	ok: boolean;
	/** Assistant text when the turn completed. */
	text?: string;
	/** Raw error payload, shaped for the cli-error explainers. */
	error?: string;
	cancelled?: boolean;
	timedOut?: boolean;
}

// Returns null when the server can't be started, so callers can fall back to the
// one-shot `opencode run` path instead of failing the generation.
export async function startOpenCodeServer(
	binary: string,
	cwd: string,
	env: NodeJS.ProcessEnv,
	signal?: AbortSignal
): Promise<OpenCodeServer | null> {
	// Loopback with a random port is still reachable by any local process, so
	// require basic auth with a per-run secret.
	const password = randomBytes(24).toString('hex');
	let child: ChildProcess;
	try {
		child = spawn(binary, ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
			cwd,
			env: { ...process.env, ...env, OPENCODE_SERVER_PASSWORD: password },
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		});
	} catch {
		return null;
	}

	let killed = false;
	const kill = () => {
		if (killed) return;
		killed = true;
		try {
			child.kill('SIGTERM');
		} catch {
			// ignore
		}
		// Never leave a headless server running if it ignores the polite signal.
		const hard = setTimeout(() => {
			try {
				child.kill('SIGKILL');
			} catch {
				// ignore
			}
		}, 2_000);
		hard.unref?.();
	};

	const url = await new Promise<string | null>((resolve) => {
		let output = '';
		let done = false;
		const settle = (value: string | null) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			// Stop buffering the server log, but keep draining the pipes so a full
			// buffer can never block the server.
			child.stdout?.off('data', onData);
			child.stderr?.off('data', onData);
			child.stdout?.resume();
			child.stderr?.resume();
			resolve(value);
		};
		const onData = (chunk: Buffer | string) => {
			output += String(chunk);
			const match = output.match(/https?:\/\/[^\s]+/);
			if (match) settle(match[0].trim());
		};
		const onAbort = () => settle(null);
		const timer = setTimeout(() => settle(null), STARTUP_TIMEOUT_MS);

		child.stdout?.on('data', onData);
		child.stderr?.on('data', onData);
		child.on('error', () => settle(null));
		child.on('exit', () => settle(null));
		signal?.addEventListener('abort', onAbort, { once: true });
	});

	if (!url) {
		kill();
		return null;
	}

	return {
		url,
		headers: {
			'content-type': 'application/json',
			authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
		},
		close: kill
	};
}

interface PartState {
	type: string;
	messageID: string;
	text: string;
}

// One SSE subscription per server; the active session's parts are mirrored into
// the reporter so the UI sees reasoning and answer tokens as they arrive.
export class OpenCodeStream {
	private controller = new AbortController();
	private sessionID: string | null = null;
	private order: string[] = [];
	private parts = new Map<string, PartState>();
	// The session echoes the prompt back as a user message part, so parts are
	// only rendered once their message is known to be the assistant's.
	private roles = new Map<string, string>();
	private reporter: StreamReporter | null = null;

	private constructor(private server: OpenCodeServer) {}

	static async open(server: OpenCodeServer): Promise<OpenCodeStream | null> {
		const stream = new OpenCodeStream(server);
		const started = await stream.connect();
		return started ? stream : null;
	}

	/** Point the stream at a new session/turn. */
	watch(sessionID: string, reporter: StreamReporter): void {
		this.sessionID = sessionID;
		this.reporter = reporter;
		this.order = [];
		this.parts.clear();
		this.roles.clear();
	}

	close(): void {
		this.controller.abort();
	}

	private async connect(): Promise<boolean> {
		let response: Response;
		try {
			response = await fetch(`${this.server.url}/event`, {
				headers: { authorization: this.server.headers.authorization! },
				signal: this.controller.signal
			});
		} catch {
			return false;
		}
		if (!response.ok || !response.body) return false;
		void this.pump(response.body);
		return true;
	}

	private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) return;
				buffer += decoder.decode(value, { stream: true });
				let index: number;
				while ((index = buffer.indexOf('\n\n')) >= 0) {
					const frame = buffer.slice(0, index);
					buffer = buffer.slice(index + 2);
					const line = frame.split('\n').find((l) => l.startsWith('data:'));
					if (!line) continue;
					try {
						this.handle(JSON.parse(line.slice(5).trim()));
					} catch {
						// A frame we can't parse is not worth failing the run over.
					}
				}
			}
		} catch {
			// Stream closed (server shut down or run aborted).
		}
	}

	private handle(event: unknown): void {
		if (!event || typeof event !== 'object') return;
		const { type, properties } = event as {
			type?: string;
			properties?: Record<string, unknown>;
		};
		if (!type || !properties) return;
		if (!this.sessionID || properties.sessionID !== this.sessionID) return;

		if (type === 'message.updated') {
			const info = properties.info as { id?: string; role?: string } | undefined;
			if (typeof info?.id === 'string' && typeof info.role === 'string') {
				this.roles.set(info.id, info.role);
				this.render();
			}
			return;
		}

		if (type === 'message.part.updated') {
			const part = properties.part as
				| { id?: string; type?: string; messageID?: string; text?: string }
				| undefined;
			if (!part?.id || !part.messageID) return;
			if (!this.parts.has(part.id)) this.order.push(part.id);
			this.parts.set(part.id, {
				type: part.type ?? 'text',
				messageID: part.messageID,
				text: typeof part.text === 'string' ? part.text : ''
			});
			this.render();
			return;
		}

		if (type === 'message.part.delta') {
			const { partID, field, delta } = properties as {
				partID?: string;
				field?: string;
				delta?: string;
			};
			if (!partID || field !== 'text' || typeof delta !== 'string') return;
			const part = this.parts.get(partID);
			if (!part) return;
			part.text += delta;
			this.render();
		}
	}

	private render(): void {
		if (!this.reporter) return;
		const thinking: string[] = [];
		const answer: string[] = [];
		for (const id of this.order) {
			const part = this.parts.get(id);
			if (!part?.text) continue;
			if (this.roles.get(part.messageID) !== 'assistant') continue;
			if (part.type === 'reasoning') thinking.push(part.text);
			else if (part.type === 'text') answer.push(part.text);
		}
		this.reporter.setThinking(thinking.join('\n\n'));
		this.reporter.setAnswer(answer.join('\n\n'));
	}
}

export async function createOpenCodeSession(server: OpenCodeServer): Promise<string | null> {
	try {
		const response = await fetch(`${server.url}/session`, {
			method: 'POST',
			headers: server.headers,
			body: JSON.stringify({ title: 'Commit message' })
		});
		if (!response.ok) return null;
		const session = (await response.json()) as { id?: string };
		return typeof session.id === 'string' ? session.id : null;
	} catch {
		return null;
	}
}

export async function sendOpenCodeMessage(
	server: OpenCodeServer,
	sessionID: string,
	model: string,
	prompt: string,
	timeoutMs: number,
	signal?: AbortSignal
): Promise<OpenCodeReply> {
	const slash = model.indexOf('/');
	if (slash <= 0) return { ok: false, error: `Invalid model \`${model}\`` };
	const providerID = model.slice(0, slash);
	const modelID = model.slice(slash + 1);

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	signal?.addEventListener('abort', onAbort, { once: true });
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	try {
		const response = await fetch(`${server.url}/session/${sessionID}/message`, {
			method: 'POST',
			headers: server.headers,
			signal: controller.signal,
			body: JSON.stringify({
				model: { providerID, modelID },
				parts: [{ type: 'text', text: prompt }]
			})
		});

		const raw = await response.text();
		if (!response.ok) return { ok: false, error: raw };

		let message: {
			info?: { error?: unknown };
			parts?: Array<{ type?: string; text?: string }>;
		};
		try {
			message = JSON.parse(raw) as typeof message;
		} catch {
			return { ok: false, error: raw };
		}
		if (message.info?.error) {
			return { ok: false, error: JSON.stringify(message.info.error) };
		}
		const text = (message.parts ?? [])
			.filter((p) => p.type === 'text' && typeof p.text === 'string')
			.map((p) => p.text!)
			.join('\n');
		return { ok: true, text };
	} catch (err) {
		if (timedOut) return { ok: false, timedOut: true, error: 'Timed out' };
		if (signal?.aborted) return { ok: false, cancelled: true, error: 'Cancelled' };
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}
