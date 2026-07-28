import { COMMIT_MESSAGE_JSON_SCHEMA } from '../prompt.js';
import { parseCommitMessageOutput } from '../parse.js';
import { spawnCapture } from '../spawn.js';
import type { AdapterInput, AdapterResult } from './types.js';

const MODEL = 'claude-haiku-4-5';

export async function generateWithClaude(input: AdapterInput): Promise<AdapterResult> {
	const result = await spawnCapture(
		input.binary,
		[
			'-p',
			'--output-format',
			'json',
			'--json-schema',
			JSON.stringify(COMMIT_MESSAGE_JSON_SCHEMA),
			'--model',
			MODEL,
			'--dangerously-skip-permissions'
		],
		{ cwd: input.cwd, stdin: input.prompt }
	);

	if (result.timedOut) {
		return { ok: false, code: 'timeout', error: result.error ?? 'Timed out' };
	}

	// `claude -p --output-format json` wraps structured_output in a result object.
	const fromStructured = parseStructuredClaudeOutput(result.stdout);
	const parsed = fromStructured ?? parseCommitMessageOutput(result.stdout);
	if (!parsed) {
		return {
			ok: false,
			code: result.ok ? 'empty' : 'failed',
			error: result.error ?? 'Claude returned no usable commit message.'
		};
	}
	return { ok: true, subject: parsed.subject, body: parsed.body };
}

function parseStructuredClaudeOutput(stdout: string): { subject: string; body: string } | null {
	try {
		const wrapper = JSON.parse(stdout) as {
			structured_output?: { subject?: unknown; body?: unknown };
			result?: string;
		};
		const structured = wrapper.structured_output;
		if (structured && typeof structured.subject === 'string') {
			return parseCommitMessageOutput(
				JSON.stringify({
					subject: structured.subject,
					body: typeof structured.body === 'string' ? structured.body : ''
				})
			);
		}
		if (typeof wrapper.result === 'string') {
			return parseCommitMessageOutput(wrapper.result);
		}
	} catch {
		// fall through
	}
	return null;
}
