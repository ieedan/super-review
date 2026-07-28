import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	combineCliOutput,
	explainOpenCodeFailure,
	explainOpenCodeNoModels,
	isRetryableOpenCodeModelFailure
} from '../cli-error.js';
import {
	listOpenCodeModels,
	selectOpenCodeModelCandidates
} from '../opencode-models.js';
import { parseCommitMessageOutput } from '../parse.js';
import { spawnCapture } from '../spawn.js';
import type { AdapterInput, AdapterResult } from './types.js';

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

	// One-shot `opencode run` with a deny-all permission config so the agent
	// cannot edit, shell, or fetch — the patch is already in the prompt.
	const dir = await mkdtemp(path.join(tmpdir(), 'sr-opencode-'));
	const configPath = path.join(dir, 'opencode.json');
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

		for (const candidate of candidates) {
			tried.push(candidate.slug);
			const result = await spawnCapture(
				input.binary,
				['run', '--model', candidate.slug, '--format', 'default', input.prompt],
				{
					cwd: input.cwd,
					env: {
						OPENCODE_CONFIG: configPath
					}
				}
			);

			if (result.timedOut) {
				return { ok: false, code: 'timeout', error: result.error ?? 'Timed out' };
			}

			const parsed = parseCommitMessageOutput(result.stdout);
			if (parsed) {
				return { ok: true, subject: parsed.subject, body: parsed.body };
			}

			const combined = combineCliOutput(result.stdout, result.stderr);
			const failure: AdapterResult = {
				ok: false,
				code: result.ok ? 'empty' : 'failed',
				error: explainOpenCodeFailure(combined || result.error || '', {
					model: candidate.slug,
					modelCount: models.length,
					triedModels: tried
				})
			};
			lastFailure = failure;

			// Successful CLI exit with unparseable output: don't burn more models.
			if (result.ok) return failure;
			if (!isRetryableOpenCodeModelFailure(combined || result.error || '')) {
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
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}
