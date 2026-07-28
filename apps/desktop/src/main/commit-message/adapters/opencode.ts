import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { combineCliOutput, explainOpenCodeFailure } from '../cli-error.js';
import { parseCommitMessageOutput } from '../parse.js';
import { spawnCapture } from '../spawn.js';
import type { AdapterInput, AdapterResult } from './types.js';

// Cheap/fast default; provider/model slug form required by OpenCode.
const MODEL = 'openai/gpt-4.1-mini';

export async function generateWithOpenCode(input: AdapterInput): Promise<AdapterResult> {
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

		const result = await spawnCapture(
			input.binary,
			['run', '--model', MODEL, '--format', 'default', input.prompt],
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
		return {
			ok: false,
			code: result.ok ? 'empty' : 'failed',
			error: explainOpenCodeFailure(combined || result.error || '', MODEL)
		};
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}
