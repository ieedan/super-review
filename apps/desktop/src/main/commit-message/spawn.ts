import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export const GENERATION_TIMEOUT_MS = 90_000;
// A run that has to explore the repo before it can write anything: reading files,
// running git, following what it finds. Minutes, not seconds.
export const AGENT_TIMEOUT_MS = 600_000;

export interface SpawnCaptureResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	code: number | null;
	timedOut: boolean;
	cancelled?: boolean;
	error?: string;
}

export interface SpawnCaptureOptions {
	cwd: string;
	env?: NodeJS.ProcessEnv;
	stdin?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	// Called with cumulative stdout as chunks arrive (for streaming UIs).
	onStdout?: (stdout: string) => void;
	// Called with each raw stdout chunk (for NDJSON event parsers).
	onStdoutChunk?: (chunk: string) => void;
	// Called with each raw stderr chunk (some CLIs stream progress there).
	onStderrChunk?: (chunk: string) => void;
	// Kill signal / cleanup hook for callers that hold the child (ACP).
	onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
}

// Run a CLI, optionally feed stdin, capture stdout/stderr, enforce a timeout.
export function spawnCapture(
	command: string,
	args: string[],
	opts: SpawnCaptureOptions
): Promise<SpawnCaptureResult> {
	const timeoutMs = opts.timeoutMs ?? GENERATION_TIMEOUT_MS;
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: SpawnCaptureResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', onAbort);
			resolve(result);
		};

		const killChild = (child: ChildProcessWithoutNullStreams) => {
			try {
				child.kill('SIGTERM');
			} catch {
				// ignore
			}
			setTimeout(() => {
				try {
					child.kill('SIGKILL');
				} catch {
					// ignore
				}
			}, 2_000);
		};

		if (opts.signal?.aborted) {
			finish({
				ok: false,
				stdout: '',
				stderr: '',
				code: null,
				timedOut: false,
				cancelled: true,
				error: 'Cancelled'
			});
			return;
		}

		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(command, args, {
				cwd: opts.cwd,
				env: { ...process.env, ...opts.env },
				stdio: ['pipe', 'pipe', 'pipe'],
				windowsHide: true
			});
		} catch (err) {
			finish({
				ok: false,
				stdout: '',
				stderr: '',
				code: null,
				timedOut: false,
				error: err instanceof Error ? err.message : String(err)
			});
			return;
		}

		opts.onSpawn?.(child);

		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
			opts.onStdoutChunk?.(chunk);
			opts.onStdout?.(stdout);
		});
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
			opts.onStderrChunk?.(chunk);
		});

		const onAbort = () => {
			killChild(child);
			finish({
				ok: false,
				stdout,
				stderr,
				code: null,
				timedOut: false,
				cancelled: true,
				error: 'Cancelled'
			});
		};
		opts.signal?.addEventListener('abort', onAbort, { once: true });

		const timer = setTimeout(() => {
			killChild(child);
			finish({
				ok: false,
				stdout,
				stderr,
				code: null,
				timedOut: true,
				error: `Timed out after ${Math.round(timeoutMs / 1000)}s`
			});
		}, timeoutMs);

		child.on('error', (err) => {
			finish({
				ok: false,
				stdout,
				stderr,
				code: null,
				timedOut: false,
				error: err.message
			});
		});

		child.on('close', (code) => {
			if (opts.signal?.aborted) {
				finish({
					ok: false,
					stdout,
					stderr,
					code: null,
					timedOut: false,
					cancelled: true,
					error: 'Cancelled'
				});
				return;
			}
			finish({
				ok: code === 0,
				stdout,
				stderr,
				code,
				timedOut: false,
				error: code === 0 ? undefined : stderr.trim() || `Exited with code ${code}`
			});
		});

		if (opts.stdin != null) {
			child.stdin.write(opts.stdin);
		}
		child.stdin.end();
	});
}
