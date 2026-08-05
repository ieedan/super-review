// Evaluates a regex literal against a test string for the inline regex tester.
// Pure and DOM-free: the popup calls `evaluateRegex` on every (debounced)
// keystroke and renders whatever comes back.
//
// Evaluation uses the browser's own `RegExp`, which is exactly right for the
// JS/TS literals we detect: the engine running the test is the engine that
// will run the code.

export interface RegexMatchRange {
	// Offsets into the test string, end-exclusive.
	start: number;
	end: number;
}

export type RegexEvaluation =
	// The literal itself doesn't compile (bad pattern, or a flag combination
	// `RegExp` rejects). `error` is the engine's own message.
	| { status: 'invalid'; error: string }
	// Nothing typed yet. The popup shows a hint rather than "No match", so an
	// empty input doesn't read as a failure.
	| { status: 'idle' }
	| { status: 'no-match' }
	| { status: 'match'; ranges: RegexMatchRange[] };

// Upper bound on matches collected for a global regex. A pattern that can match
// the empty string yields one match per character, so a long test string would
// otherwise build a range per character on every keystroke. Well past anything a
// single-line test input reaches.
const MAX_MATCHES = 1000;

// Compile the literal, returning either the regex or the engine's error message.
// A fresh `RegExp` per call keeps `lastIndex` from leaking between evaluations
// (sticky and global regexes are stateful).
export function compileRegex(
	pattern: string,
	flags: string
): { regex: RegExp } | { error: string } {
	try {
		return { regex: new RegExp(pattern, flags) };
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

// Run `pattern`/`flags` against `input` and describe the result. A global (or
// sticky) regex reports every match so the input highlights them all; a
// non-global one reports just the first, matching what the code itself would do.
export function evaluateRegex(pattern: string, flags: string, input: string): RegexEvaluation {
	const compiled = compileRegex(pattern, flags);
	if ('error' in compiled) return { status: 'invalid', error: compiled.error };
	if (input === '') return { status: 'idle' };

	const { regex } = compiled;
	const ranges: RegexMatchRange[] = [];

	if (regex.global || regex.sticky) {
		regex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(input)) != null) {
			ranges.push({ start: match.index, end: match.index + match[0].length });
			// A zero-length match leaves `lastIndex` where it was, so step past it
			// manually or `exec` would return the same match forever.
			if (match[0].length === 0) regex.lastIndex++;
			if (regex.lastIndex > input.length || ranges.length >= MAX_MATCHES) break;
		}
	} else {
		const match = regex.exec(input);
		if (match) ranges.push({ start: match.index, end: match.index + match[0].length });
	}

	if (ranges.length === 0) return { status: 'no-match' };
	return { status: 'match', ranges };
}

export interface RegexSegment {
	text: string;
	matched: boolean;
}

// Split `input` into alternating matched/unmatched runs, which is what the
// input's highlight backdrop renders. Ranges arrive in ascending order from
// `evaluateRegex`; zero-length matches produce no segment of their own (there's
// nothing to paint) but don't disturb the surrounding text.
export function segmentsFor(input: string, ranges: RegexMatchRange[]): RegexSegment[] {
	const segments: RegexSegment[] = [];
	let cursor = 0;
	for (const range of ranges) {
		// Zero-length matches paint nothing, and splitting the surrounding text
		// around them would emit adjacent unmatched runs for no reason.
		if (range.end <= range.start) continue;
		if (range.start > cursor) {
			segments.push({ text: input.slice(cursor, range.start), matched: false });
		}
		segments.push({ text: input.slice(range.start, range.end), matched: true });
		cursor = range.end;
	}
	if (cursor < input.length) segments.push({ text: input.slice(cursor), matched: false });
	return segments;
}

// The status line's text for a settled evaluation, e.g. `Match at characters
// 4-9` for a single hit or `3 matches` once there are several. Character
// positions are 0-based (the offsets `String.prototype.indexOf` and friends
// report), stated end-exclusive as the range the match covers.
export function describeMatch(ranges: RegexMatchRange[]): string {
	if (ranges.length === 0) return 'No match';
	if (ranges.length === 1) {
		const [range] = ranges;
		if (range.end === range.start) return `Empty match at character ${range.start}`;
		return `Match at characters ${range.start}-${range.end}`;
	}
	return `${ranges.length} matches`;
}
