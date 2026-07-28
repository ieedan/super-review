import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COMMIT_MESSAGE_JSON_SCHEMA } from '../prompt.js';
import { parseCommitMessageOutput } from '../parse.js';
import { spawnCapture } from '../spawn.js';
import type { AdapterInput, AdapterResult } from './types.js';

const MODEL = 'gpt-5.6-luna';

export async function generateWithCodex(input: AdapterInput): Promise<AdapterResult> {
	const dir = await mkdtemp(path.join(tmpdir(), 'sr-codex-'));
	const schemaPath = path.join(dir, 'schema.json');
	const outputPath = path.join(dir, 'last-message.txt');
	try {
		await writeFile(schemaPath, JSON.stringify(COMMIT_MESSAGE_JSON_SCHEMA), 'utf8');
		const result = await spawnCapture(
			input.binary,
			[
				'exec',
				'--ephemeral',
				'--skip-git-repo-check',
				'-s',
				'read-only',
				'--model',
				MODEL,
				'--config',
				'model_reasoning_effort="low"',
				'--output-schema',
				schemaPath,
				'--output-last-message',
				outputPath,
				'-'
			],
			{ cwd: input.cwd, stdin: input.prompt }
		);

		if (result.timedOut) {
			return { ok: false, code: 'timeout', error: result.error ?? 'Timed out' };
		}

		let raw = '';
		try {
			raw = await readFile(outputPath, 'utf8');
		} catch {
			raw = result.stdout;
		}

		const parsed = parseCommitMessageOutput(raw);
		if (!parsed) {
			return {
				ok: false,
				code: 'empty',
				error: result.error ?? 'Codex returned no usable commit message.'
			};
		}
		return { ok: true, subject: parsed.subject, body: parsed.body };
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}
