export interface ParsedCommitMessage {
	subject: string;
	body: string;
}

// Pull a JSON object out of model output that may include fences or prose, then
// sanitize the subject/body for the commit box.
export function parseCommitMessageOutput(raw: string): ParsedCommitMessage | null {
	const json = extractJsonObject(raw);
	if (!json) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;
	const subjectRaw = typeof obj.subject === 'string' ? obj.subject : null;
	if (!subjectRaw) return null;
	const bodyRaw = typeof obj.body === 'string' ? obj.body : '';
	const subject = sanitizeSubject(subjectRaw);
	if (!subject) return null;
	return { subject, body: bodyRaw.trim() };
}

export function sanitizeSubject(subject: string): string {
	let s = subject.trim().replace(/\s+/g, ' ');
	// Drop wrapping quotes models sometimes add.
	if (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'"))
	) {
		s = s.slice(1, -1).trim();
	}
	while (s.endsWith('.')) s = s.slice(0, -1).trimEnd();
	if (s.length > 72) s = s.slice(0, 72).trimEnd();
	return s;
}

function extractJsonObject(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	// Prefer fenced ```json blocks when present.
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fence ? fence[1].trim() : trimmed;

	if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;

	const start = candidate.indexOf('{');
	const end = candidate.lastIndexOf('}');
	if (start >= 0 && end > start) return candidate.slice(start, end + 1);
	return null;
}
