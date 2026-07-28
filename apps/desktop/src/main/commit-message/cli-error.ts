// Turn raw harness CLI stderr/stdout into a short, actionable error for the
// commit-message toast. CLIs often dump ANSI-colored JSON; we strip that and
// map known shapes (especially OpenCode's UnknownError) to plain English.

const ANSI_RE = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, '');
}

export function combineCliOutput(stdout: string, stderr: string): string {
	const out = stripAnsi(stdout).trim();
	const err = stripAnsi(stderr).trim();
	if (out && err) return `${err}\n${out}`;
	return err || out;
}

// OpenCode (and some other CLIs) print structured errors like:
//   Error: { "name": "UnknownError", "data": { "message": "...", "ref": "err_…" } }
export function explainOpenCodeFailure(raw: string, model: string): string {
	const cleaned = stripAnsi(raw).trim();
	const structured = extractStructuredError(cleaned);
	const message = structured?.message ?? cleaned;
	const lower = message.toLowerCase();

	if (
		/\b(not logged in|unauthori[sz]ed|authentication|auth required|please log ?in|sign[- ]?in)\b/.test(
			lower
		) ||
		/\b(401|403)\b/.test(lower)
	) {
		return `OpenCode isn't authenticated. Run \`opencode auth login\` in a terminal, then try again.`;
	}

	if (/\b(model .+ not found|unknown model|no such model|model unavailable)\b/.test(lower)) {
		return `OpenCode doesn't have model \`${model}\` available. Configure a provider that offers it, or pick a different harness in Agents settings.`;
	}

	if (
		/\b(no provider|provider .+ not (found|configured|available)|missing api key|invalid api key)\b/.test(
			lower
		)
	) {
		return `OpenCode has no provider configured for \`${model}\`. Run \`opencode auth login\` (or add an API key), then try again.`;
	}

	// OpenCode's generic 500 wrapper. Usually means auth/provider/config is broken
	// on their side; the ref is only useful if the user digs into OpenCode logs.
	if (
		structured?.name === 'UnknownError' ||
		/unexpected server error/i.test(message) ||
		/^error:\s*\{/.test(cleaned.toLowerCase())
	) {
		const ref = structured?.ref ? ` (ref ${structured.ref})` : '';
		return (
			`OpenCode failed with an unexpected server error${ref}. ` +
			`Usually this means you aren't signed in, or no provider is set up for \`${model}\`. ` +
			`Run \`opencode auth login\` in a terminal (or check Agents settings for another harness).`
		);
	}

	if (!cleaned) return 'OpenCode failed to generate a commit message.';

	// Prefer a single-line summary; keep the first sentence/paragraph only.
	const firstLine = cleaned
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!firstLine) return 'OpenCode failed to generate a commit message.';
	// Drop a leading "Error:" label; we already toast as an error.
	return firstLine.replace(/^error:\s*/i, '').trim() || firstLine;
}

interface StructuredCliError {
	name?: string;
	message: string;
	ref?: string;
}

function extractStructuredError(raw: string): StructuredCliError | null {
	// Strip a leading "Error:" label so the rest can be JSON.
	const body = raw.replace(/^error:\s*/i, '').trim();
	const jsonText = extractJsonObject(body);
	if (!jsonText) return null;
	try {
		const parsed = JSON.parse(jsonText) as {
			name?: unknown;
			data?: { message?: unknown; ref?: unknown };
			message?: unknown;
		};
		const message =
			(typeof parsed.data?.message === 'string' && parsed.data.message) ||
			(typeof parsed.message === 'string' && parsed.message) ||
			null;
		if (!message) return null;
		return {
			name: typeof parsed.name === 'string' ? parsed.name : undefined,
			message,
			ref: typeof parsed.data?.ref === 'string' ? parsed.data.ref : undefined
		};
	} catch {
		return null;
	}
}

function extractJsonObject(raw: string): string | null {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	return raw.slice(start, end + 1);
}
