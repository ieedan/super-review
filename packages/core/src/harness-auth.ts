// Recognizing "this harness CLI isn't signed in" in whatever it printed.
//
// Every harness fails differently — Claude Code says "OAuth session expired",
// Codex says "not logged in", Cursor returns a 401 — and all of it used to land
// in an error toast as raw CLI text, with no indication that the fix was one
// terminal command. This module turns that text into a single classification so
// callers can offer the fix instead of the transcript.
//
// Lives in core (rather than next to the adapters that call it) because it is
// pure string work with no Electron or node dependency, which makes it testable.

import type { CommitMessageHarness } from './types.js';
import { harnessLabel, harnessLoginHint } from './types.js';

// ESC and BEL, built from char codes rather than written into the pattern: a
// literal escape byte in a source file is invisible to every reader and to most
// tooling, and these patterns are fiddly enough already.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// CLIs emit more than color. `cursor-agent models` draws its "Loading models…"
// spinner with erase-line and cursor-move sequences (ESC[2K, ESC[G, ESC[1A) —
// none of which end in `m`, so matching only SGR leaves them riding along on the
// text. Match the general CSI form (parameters, then intermediates, then a final
// byte in @-~), OSC strings, and the two-character escapes.
const ANSI_RE = new RegExp(
	[
		`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
		`${ESC}\\[[0-9;?]*[ -/]*[@-~]`,
		`${ESC}[@-Z\\\\-_]`
	].join('|'),
	'g'
);

// A CLI killed mid-write can leave a half-finished escape at the end of a line,
// which no complete-sequence pattern matches. Drop those too, rather than letting
// an `ESC[22` ride along on the last value parsed out of the output.
const PARTIAL_ANSI_RE = new RegExp(`${ESC}(?:\\][^${BEL}${ESC}]*|\\[[0-9;?]*[ -/]*)?$`, 'gm');

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, '').replace(PARTIAL_ANSI_RE, '');
}

// Deliberately tight. A false positive here tells the user to re-authenticate
// when the real problem was something else, which is worse than passing the raw
// error through — so rate limits (429), server faults (500/503) and quota
// messages are *not* auth, even though they also stop a run dead.
const AUTH_PATTERNS: readonly RegExp[] = [
	// Claude Code: the exact string this whole change started from.
	/oauth session expired/i,
	/failed to authenticate/i,
	// Shared across CLIs.
	/\bnot logged ?in\b/i,
	/\bnot authenticated\b/i,
	/\bplease log ?in\b/i,
	/\bplease sign ?in\b/i,
	/\bauthentication (?:failed|required|error)\b/i,
	/\bunauthenticated\b/i,
	/\bunauthori[sz]ed\b/i,
	/\b(?:invalid|expired|missing|revoked) (?:api ?key|token|credentials?|session)\b/i,
	/\bsession (?:has )?expired\b/i,
	/\brun `?(?:claude|codex|cursor-agent|agent|copilot|opencode)[^`\n]*\b(?:login|auth)\b/i,
	// Bare HTTP status lines. 403 is included because every CLI here uses it for
	// "your session is fine but it isn't allowed to do this", which the user
	// still fixes by signing in again.
	/\bhttp (?:401|403)\b/i,
	/\bstatus (?:code )?(?:401|403)\b/i,
	/\b(?:401|403) (?:unauthori[sz]ed|forbidden)\b/i
];

/** True when a failed run's output says the CLI has no usable session. */
export function looksLikeAuthFailure(raw: string | undefined | null): boolean {
	if (!raw) return false;
	const cleaned = stripAnsi(raw);
	if (!cleaned.trim()) return false;
	return AUTH_PATTERNS.some((pattern) => pattern.test(cleaned));
}

/**
 * The message shown when a harness turns out to be signed out. Leads with which
 * CLI and what to run — the raw CLI text is kept only as a trailing detail,
 * because "OAuth session expired and could not be refreshed" on its own never
 * told anyone which of the five CLIs it came from or what to do about it.
 */
export function explainAuthFailure(harness: CommitMessageHarness, raw?: string | null): string {
	const headline = `${harnessLabel(harness)} isn't signed in. To fix it, ${harnessLoginHint(harness)} in a terminal, then try again.`;
	const detail = firstMeaningfulLine(raw);
	return detail ? `${headline}\n\n${detail}` : headline;
}

// The CLI's own words, trimmed to one line, so the toast's detail view still
// shows what actually came back without the headline drowning in it.
function firstMeaningfulLine(raw: string | undefined | null): string | null {
	if (!raw) return null;
	const line = stripAnsi(raw)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!line) return null;
	return line.replace(/^error:\s*/i, '').trim() || null;
}
