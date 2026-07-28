import { parseCommitMessageOutput } from '../parse.js';
import { spawnCapture } from '../spawn.js';
import type { AdapterInput, AdapterResult } from './types.js';

const MODEL = 'claude-haiku-4.5';

export async function generateWithCopilot(input: AdapterInput): Promise<AdapterResult> {
	// Patch is already inlined in the prompt; deny every tool so the agent can
	// only return text. --no-ask-user keeps it non-interactive.
	const result = await spawnCapture(
		input.binary,
		[
			'-p',
			input.prompt,
			'-s',
			'--model',
			MODEL,
			'--no-ask-user',
			"--deny-tool=shell,write,url,memory,read"
		],
		{ cwd: input.cwd }
	);

	if (result.timedOut) {
		return { ok: false, code: 'timeout', error: result.error ?? 'Timed out' };
	}

	const parsed = parseCommitMessageOutput(result.stdout);
	if (!parsed) {
		return {
			ok: false,
			code: result.ok ? 'empty' : 'failed',
			error: result.error ?? 'Copilot returned no usable commit message.'
		};
	}
	return { ok: true, subject: parsed.subject, body: parsed.body };
}
