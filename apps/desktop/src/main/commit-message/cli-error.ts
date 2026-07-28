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

export interface ExplainOpenCodeFailureOptions {
	model: string;
	/** How many models `opencode models` returned for this user. */
	modelCount: number;
	/** Models we already tried (cheapest/fastest first). */
	triedModels?: string[];
}

// OpenCode (and some other CLIs) print structured errors like:
//   Error: { "name": "UnknownError", "data": { "message": "...", "ref": "err_…" } }
export function explainOpenCodeFailure(
	raw: string,
	opts: ExplainOpenCodeFailureOptions
): string {
	const { model, modelCount } = opts;
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
		return (
			`OpenCode doesn't have model \`${model}\` available` +
			(modelCount > 0 ? ` (your providers list ${modelCount} model${modelCount === 1 ? '' : 's'})` : '') +
			`. Pick another harness in Agents settings, or run \`opencode auth login\` to add a provider.`
		);
	}

	if (
		/\b(no provider|provider .+ not (found|configured|available)|missing api key|invalid api key)\b/.test(
			lower
		)
	) {
		return `OpenCode has no usable provider for \`${model}\`. Run \`opencode auth login\` (or add an API key), then try again.`;
	}

	// OpenCode's generic 500 wrapper. When we already discovered models, this is
	// almost always "listed but not callable" for that slug — not missing auth.
	if (
		structured?.name === 'UnknownError' ||
		/unexpected server error/i.test(message) ||
		/^error:\s*\{/.test(cleaned.toLowerCase())
	) {
		const ref = structured?.ref ? ` (ref ${structured.ref})` : '';
		if (modelCount > 0) {
			const tried = opts.triedModels?.length
				? ` Tried: ${opts.triedModels.map((m) => `\`${m}\``).join(', ')}.`
				: '';
			return (
				`OpenCode rejected \`${model}\`${ref}. ` +
				`Your providers list ${modelCount} model${modelCount === 1 ? '' : 's'}, but this one isn't callable ` +
				`(wrong access, quota, or a bad models.dev listing).${tried} ` +
				`Add another provider with \`opencode auth login\`, or pick a different harness in Agents settings.`
			);
		}
		return (
			`OpenCode failed with an unexpected server error${ref}. ` +
			`Usually this means you aren't signed in, or no provider is set up. ` +
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

export function explainOpenCodeNoModels(detail?: string): string {
	const cleaned = detail ? stripAnsi(detail).trim() : '';
	if (
		cleaned &&
		/\b(not logged in|unauthori[sz]ed|authentication|auth required|please log ?in|sign[- ]?in)\b/i.test(
			cleaned
		)
	) {
		return `OpenCode isn't authenticated. Run \`opencode auth login\` in a terminal, then try again.`;
	}
	return (
		`OpenCode has no models available from your configured providers. ` +
		`Run \`opencode auth login\` to sign in or add a provider, then try again.`
	);
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

/** True when the failure looks model/provider-specific and another candidate may work. */
export function isRetryableOpenCodeModelFailure(raw: string): boolean {
	const cleaned = stripAnsi(raw).trim();
	const structured = extractStructuredError(cleaned);
	const message = (structured?.message ?? cleaned).toLowerCase();
	if (structured?.name === 'UnknownError') return true;
	if (/unexpected server error/i.test(message)) return true;
	if (/\b(model .+ not found|unknown model|no such model|model unavailable)\b/.test(message)) {
		return true;
	}
	if (
		/\b(no provider|provider .+ not (found|configured|available)|missing api key|invalid api key)\b/.test(
			message
		)
	) {
		return true;
	}
	if (/\b(401|403|429|500|502|503)\b/.test(message)) return true;
	return false;
}
