import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	combineCliOutput,
	explainOpenCodeFailure,
	explainOpenCodeNoModels,
	isRetryableOpenCodeModelFailure
} from '../cli-error.js';
import { listOpenCodeModels, selectOpenCodeModelCandidates } from '../opencode-models.js';
import {
	createOpenCodeSession,
	OpenCodeStream,
	sendOpenCodeMessage,
	startOpenCodeServer,
	type OpenCodeServer
} from '../opencode-server.js';
import { parseCommitMessageOutput } from '../parse.js';
import { GENERATION_TIMEOUT_MS, spawnCapture } from '../spawn.js';
import { createStreamReporter, type StreamReporter } from '../stream.js';
import type { AdapterInput, AdapterResult } from './types.js';

interface Attempt {
	/** The call itself completed (a model can still have returned nothing). */
	ok: boolean;
	text: string;
	error?: string;
	cancelled?: boolean;
	timedOut?: boolean;
	/** The headless server can't be used; retry this candidate one-shot. */
	serverUnavailable?: boolean;
}

export async function generateWithOpenCode(input: AdapterInput): Promise<AdapterResult> {
	let models;
	try {
		models = await listOpenCodeModels(input.binary, input.cwd);
	} catch (err) {
		return {
			ok: false,
			code: 'failed',
			error: explainOpenCodeNoModels(err instanceof Error ? err.message : String(err))
		};
	}

	if (models.length === 0) {
		return {
			ok: false,
			code: 'failed',
			error: explainOpenCodeNoModels()
		};
	}

	const candidates = selectOpenCodeModelCandidates(models);
	if (candidates.length === 0) {
		return {
			ok: false,
			code: 'failed',
			error: explainOpenCodeNoModels()
		};
	}

	// Deny-all permission config so the agent cannot edit, shell, or fetch — the
	// patch is already in the prompt. Applies to both the server and `run`.
	const dir = await mkdtemp(path.join(tmpdir(), 'sr-opencode-'));
	const configPath = path.join(dir, 'opencode.json');
	const reporter = createStreamReporter(input.onProgress);
	let server: OpenCodeServer | null = null;
	let stream: OpenCodeStream | null = null;
	try {
		await writeFile(
			configPath,
			JSON.stringify({
				$schema: 'https://opencode.ai/config.json',
				permission: {
					'*': 'deny',
					bash: 'deny',
					edit: 'deny',
					write: 'deny',
					read: 'deny',
					webfetch: 'deny',
					websearch: 'deny',
					question: 'deny',
					external_directory: 'deny'
				}
			}),
			'utf8'
		);

		const tried: string[] = [];
		let lastFailure: AdapterResult | null = null;

		const preferred = input.model?.trim();
		const ordered = preferred
			? [{ slug: preferred }, ...candidates.filter((c) => c.slug !== preferred)]
			: candidates;

		// `opencode run` only prints when the whole turn is done, so prefer the
		// headless server, which streams token deltas over SSE.
		server = await startOpenCodeServer(
			input.binary,
			input.cwd,
			{ OPENCODE_CONFIG: configPath },
			input.signal
		);
		stream = server ? await OpenCodeStream.open(server) : null;
		if (server && !stream) {
			server.close();
			server = null;
		}

		for (const candidate of ordered) {
			if (input.signal?.aborted) {
				return { ok: false, code: 'cancelled', error: 'Cancelled' };
			}
			tried.push(candidate.slug);
			reporter.reset();

			let attempt: Attempt;
			if (server && stream) {
				attempt = await runOnServer(server, stream, candidate.slug, input, reporter);
				if (attempt.serverUnavailable) {
					stream.close();
					server.close();
					stream = null;
					server = null;
					attempt = await runOneShot(configPath, candidate.slug, input, reporter);
				}
			} else {
				attempt = await runOneShot(configPath, candidate.slug, input, reporter);
			}

			if (attempt.cancelled) {
				return { ok: false, code: 'cancelled', error: 'Cancelled' };
			}
			if (attempt.timedOut) {
				return { ok: false, code: 'timeout', error: attempt.error ?? 'Timed out' };
			}

			const parsed = parseCommitMessageOutput(attempt.text);
			if (parsed) {
				return { ok: true, subject: parsed.subject, body: parsed.body };
			}

			const failure: AdapterResult = {
				ok: false,
				code: attempt.ok ? 'empty' : 'failed',
				error: explainOpenCodeFailure(attempt.error ?? '', {
					model: candidate.slug,
					modelCount: models.length,
					triedModels: tried
				})
			};
			lastFailure = failure;

			// Successful call with unparseable output: don't burn more models.
			if (attempt.ok) return failure;
			if (!isRetryableOpenCodeModelFailure(attempt.error ?? '')) {
				return failure;
			}
		}

		return (
			lastFailure ?? {
				ok: false,
				code: 'failed',
				error: explainOpenCodeNoModels()
			}
		);
	} finally {
		reporter.flush();
		stream?.close();
		server?.close();
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function runOnServer(
	server: OpenCodeServer,
	stream: OpenCodeStream,
	model: string,
	input: AdapterInput,
	reporter: StreamReporter
): Promise<Attempt> {
	const sessionID = await createOpenCodeSession(server);
	if (!sessionID) return { ok: false, text: '', serverUnavailable: true };

	stream.watch(sessionID, reporter);
	const reply = await sendOpenCodeMessage(
		server,
		sessionID,
		model,
		input.prompt,
		GENERATION_TIMEOUT_MS,
		input.signal
	);
	return {
		ok: reply.ok,
		text: reply.text ?? '',
		error: reply.error,
		cancelled: reply.cancelled,
		timedOut: reply.timedOut
	};
}

// Fallback for installs where the headless server won't start: one-shot run,
// which can only report progress once the model is done.
async function runOneShot(
	configPath: string,
	model: string,
	input: AdapterInput,
	reporter: StreamReporter
): Promise<Attempt> {
	const result = await spawnCapture(
		input.binary,
		['run', '--model', model, '--format', 'default', input.prompt],
		{
			cwd: input.cwd,
			env: { OPENCODE_CONFIG: configPath },
			signal: input.signal,
			onStdout: (stdout) => reporter.setAnswer(stdout)
		}
	);

	return {
		ok: result.ok,
		text: result.stdout,
		error: combineCliOutput(result.stdout, result.stderr) || result.error || '',
		cancelled: result.cancelled,
		timedOut: result.timedOut
	};
}
