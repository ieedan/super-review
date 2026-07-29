// Shared streaming plumbing for the commit-message adapters.
//
// Every harness exposes progress differently (NDJSON events, ACP notifications,
// plain stdout), but the UI wants the same thing: a readable, growing blob of
// text. Adapters push reasoning/answer deltas in here and this module handles
// throttling and keeping the partial answer readable while it streams.

import { stripAnsi } from './cli-error.js';
import type { CommitMessageProgressEvent } from '@super-review/core/types';

// Coalesce bursts of token deltas into one IPC message per frame-ish.
const EMIT_INTERVAL_MS = 50;

export interface StreamReporter {
	addThinking(delta: string): void;
	/** Replace the reasoning text (for CLIs that emit whole blocks). */
	setThinking(text: string): void;
	addAnswer(delta: string): void;
	/** Replace the answer wholesale (for CLIs that only emit cumulative text). */
	setAnswer(text: string): void;
	/** Raw accumulated answer text, for adapters that parse it as the result. */
	answerText(): string;
	/** Drop everything collected so far (a retry starts from nothing). */
	reset(): void;
	/** Emit any pending update now and stop the timer. */
	flush(): void;
}

// Progress is only ever real model output: nothing is reported until the
// harness produces reasoning or answer text, so the UI owns the waiting state.
export function createStreamReporter(
	onProgress: ((event: CommitMessageProgressEvent) => void) | undefined
): StreamReporter {
	let thinking = '';
	let answer = '';
	let lastEmitted = '';
	let lastEmitAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const render = (): CommitMessageProgressEvent => ({
		reasoning: stripAnsi(thinking).trim(),
		answer: formatCommitMessageStream(answer)
	});

	const emit = (): void => {
		timer = undefined;
		lastEmitAt = Date.now();
		const next = render();
		const key = `${next.reasoning}\u0000${next.answer}`;
		if (key === lastEmitted) return;
		lastEmitted = key;
		onProgress?.(next);
	};

	const schedule = (): void => {
		if (!onProgress || timer) return;
		const wait = Math.max(0, EMIT_INTERVAL_MS - (Date.now() - lastEmitAt));
		timer = setTimeout(emit, wait);
	};

	return {
		addThinking(delta) {
			if (!delta) return;
			thinking += delta;
			schedule();
		},
		setThinking(text) {
			if (text === thinking) return;
			thinking = text;
			schedule();
		},
		addAnswer(delta) {
			if (!delta) return;
			answer += delta;
			schedule();
		},
		setAnswer(text) {
			if (text === answer) return;
			answer = text;
			schedule();
		},
		answerText() {
			return answer;
		},
		reset() {
			if (!thinking && !answer) return;
			thinking = '';
			answer = '';
			schedule();
		},
		flush() {
			if (timer) clearTimeout(timer);
			emit();
		}
	};
}

// Adapters get stdout in arbitrary chunks; NDJSON parsers want whole lines.
export function createLineReader(onLine: (line: string) => void): (chunk: string) => void {
	let buffer = '';
	return (chunk: string) => {
		buffer += chunk;
		let index: number;
		while ((index = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, index).trim();
			buffer = buffer.slice(index + 1);
			if (line) onLine(line);
		}
		// Guard against a CLI that never emits a newline (huge single-line output).
		if (buffer.length > 1_000_000) buffer = '';
	};
}

// The answer streams in as the commit message itself, so it is readable as-is —
// only the fence a model sometimes opens with needs hiding. A harness that
// answers with JSON anyway is rendered from its half-written object instead of
// showing raw braces.
export function formatCommitMessageStream(raw: string): string {
	const text = stripAnsi(raw).trim();
	if (!text) return '';

	if (text.startsWith('{')) {
		const subject = readPartialJsonString(text, 'subject')?.trim();
		const body = readPartialJsonString(text, 'body')?.trim();
		return [subject, body].filter(Boolean).join('\n\n');
	}

	// Drop an opening ``` (and the closing one once it arrives).
	return text
		.replace(/^```[^\n]*\n?/, '')
		.replace(/```\s*$/, '')
		.trim();
}

// Read a string value out of JSON that may still be mid-write. Returns the text
// decoded so far, or null when the key/opening quote hasn't arrived yet.
export function readPartialJsonString(source: string, key: string): string | null {
	const keyIndex = source.indexOf(`"${key}"`);
	if (keyIndex < 0) return null;

	let i = keyIndex + key.length + 2;
	while (i < source.length && /\s/.test(source[i]!)) i++;
	if (source[i] !== ':') return null;
	i++;
	while (i < source.length && /\s/.test(source[i]!)) i++;
	if (source[i] !== '"') return null;
	i++;

	let out = '';
	while (i < source.length) {
		const ch = source[i]!;
		if (ch === '\\') {
			const next = source[i + 1];
			if (next === undefined) return out;
			switch (next) {
				case 'n':
					out += '\n';
					break;
				case 't':
					out += '\t';
					break;
				case 'r':
					break;
				case 'u': {
					const hex = source.slice(i + 2, i + 6);
					if (hex.length < 4) return out;
					const code = Number.parseInt(hex, 16);
					if (!Number.isNaN(code)) out += String.fromCharCode(code);
					i += 6;
					continue;
				}
				default:
					out += next;
			}
			i += 2;
			continue;
		}
		if (ch === '"') return out;
		out += ch;
		i++;
	}
	return out;
}
