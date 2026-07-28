import { stripAnsi } from './cli-error.js';

export interface ParsedCommitMessage {
	subject: string;
	body: string;
}

// Harnesses reply with a plain commit message (subject, blank line, body). Some
// still wrap it in a fence or hand back a JSON object out of habit, so both are
// accepted; anything that yields no subject is treated as no answer.
export function parseCommitMessageOutput(raw: string): ParsedCommitMessage | null {
	const text = unwrapFence(stripAnsi(raw).trim());
	if (!text) return null;
	return parseJsonShape(text) ?? parsePlainMessage(text);
}

export function sanitizeSubject(subject: string): string {
	let s = subject.trim().replace(/\s+/g, ' ');
	// Drop a leading label some models add despite the instructions.
	s = s.replace(/^(?:subject|title|commit(?:\s+message)?)\s*:\s*/i, '');
	// Drop wrapping quotes models sometimes add.
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		s = s.slice(1, -1).trim();
	}
	while (s.endsWith('.')) s = s.slice(0, -1).trimEnd();
	if (s.length > 72) s = s.slice(0, 72).trimEnd();
	return s;
}

function parsePlainMessage(text: string): ParsedCommitMessage | null {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	let i = 0;
	while (i < lines.length && !lines[i]!.trim()) i++;
	if (i >= lines.length) return null;

	const subject = sanitizeSubject(lines[i]!);
	if (!subject) return null;

	const body = lines
		.slice(i + 1)
		.join('\n')
		.replace(/^\s*(?:body|description)\s*:\s*/i, '')
		.trim();
	return { subject, body };
}

function parseJsonShape(text: string): ParsedCommitMessage | null {
	if (!text.startsWith('{')) return null;
	const end = text.lastIndexOf('}');
	if (end <= 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text.slice(0, end + 1));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;
	const subjectRaw = typeof obj.subject === 'string' ? obj.subject : null;
	if (!subjectRaw) return null;
	const subject = sanitizeSubject(subjectRaw);
	if (!subject) return null;
	const body = typeof obj.body === 'string' ? obj.body.trim() : '';
	return { subject, body };
}

// ```\nfeat: …\n``` — keep the contents, drop the fence.
function unwrapFence(text: string): string {
	if (!text.startsWith('```')) return text;
	const match = text.match(/^```[^\n]*\n([\s\S]*?)```\s*$/);
	return match ? match[1]!.trim() : text;
}
