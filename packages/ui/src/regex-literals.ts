// The regex tester's detection layer: what counts as a regex in a source file,
// where it sits, and which engine dialect it was written for.
//
// Pierre reports a hovered token as a line number plus a character range within
// that line (its `data-char` offset), so every language's scanner produces the
// same thing: line -> the spans on that line, each with its own character range.
// A hover then resolves with a cheap range test, exactly like
// `package-json-deps.ts` does for package.json dependency entries.
//
// One wrinkle makes this more than "find the slashes". Only JavaScript has regex
// literals; everywhere else a regex is a *string* in a position that means
// regex, so each language needs its own scanner (see `regex-scan-*.ts`) and the
// pattern a scanner reports is the decoded string, not the source text. The
// evaluation is always the browser's `RegExp`, which is the real engine for a
// JavaScript literal but only an approximation of, say, .NET's, so a span also
// carries the dialect it came from and anything the translation had to drop.

import { compatibilityNote } from './regex-compat';
import { REGEX_EXTENSIONS, REGEX_LANGUAGES } from './regex-languages';
import { parseJsRegexLiterals } from './regex-scan-js';
import { scanRegexCalls } from './regex-scan-call';

// Whose regex engine the pattern was written for. Only `javascript` means the
// engine evaluating it is the one the code will run under, which is why it is
// the one dialect that never gets a compatibility note.
export type RegexDialect = 'javascript' | 'dotnet' | 'python' | 'java' | 're2' | 'pcre';

export interface RegexLiteralSpan {
	// 0-based character offsets within the line, end-exclusive, spanning the
	// whole thing the user sees as the regex: `/pattern/flags` in JavaScript, the
	// entire string literal (quotes, `@` prefix and all) in C#. Matched against
	// Pierre's token range.
	startCol: number;
	endCol: number;
	// The pattern as the engine receives it. For a JavaScript literal that's the
	// text between the slashes verbatim; for a C# string it's the *decoded* value,
	// so source `"\\d+"` becomes `\d+`.
	pattern: string;
	// Flags in `RegExp` terms. A JavaScript literal's own flags; for C# the
	// translatable subset of its `RegexOptions`.
	flags: string;
	// The regex as written in the source, for identity and debugging.
	source: string;
	dialect: RegexDialect;
	// Options the source language applied that `RegExp` has no equivalent for AND
	// that change whether something matches, so the note can own up to them.
	// Options that only affect capture groups or performance aren't listed.
	droppedOptions?: string[];
}

// Line number (1-based, matching Pierre's `data-line`) -> the spans on that
// line, in source order. A line can carry several.
export type RegexLiteralIndex = Map<number, RegexLiteralSpan[]>;

// Shared by the scanners, which each build one of these.
export function addSpan(index: RegexLiteralIndex, line: number, span: RegexLiteralSpan): void {
	const existing = index.get(line);
	if (existing) existing.push(span);
	else index.set(line, [span]);
}

// The scanner language for a file, or null when we have none.
export function regexLanguageFor(filePath: string): string | null {
	const base = filePath.split(/[\\/]/).pop() ?? filePath;
	const dot = base.lastIndexOf('.');
	if (dot <= 0) return null;
	return REGEX_EXTENSIONS[base.slice(dot + 1).toLowerCase()] ?? null;
}

// True when the file is one whose regexes we can find and test.
export function isRegexTestablePath(filePath: string): boolean {
	return regexLanguageFor(filePath) !== null;
}

// Index every regex in one side of a diff, using the scanner for the file's
// language. `text` is the full contents of that side; the caller keys the result
// by which side the hovered token reported.
export function parseRegexLiterals(text: string, filePath: string): RegexLiteralIndex {
	const language = regexLanguageFor(filePath);
	if (language === 'javascript') return parseJsRegexLiterals(text);
	const spec = language ? REGEX_LANGUAGES[language] : undefined;
	return spec ? scanRegexCalls(spec, text) : new Map();
}

// Whether a token at `[tokenStart, tokenEnd)` belongs to `span`.
//
// Not a plain overlap test. Syntax highlighting and intra-line diffs chop a
// regex into pieces (`/`, `^`, `\d`, `+`, ...), and each of those must resolve
// to the whole thing. But tokens also run the other way: Pierre's first,
// pre-highlight paint emits one token per *line*, and Shiki merges any run of
// characters that share a style. Overlapping alone would make the entire line
// count as the regex, so the whole line would light up as testable and a click
// anywhere on it would open the tester.
//
// The rule instead is that most of the token has to lie inside the span. A
// fragment is fully inside it (100%); a line-wide token holding a short regex is
// mostly outside it and doesn't count.
export function tokenBelongsToLiteral(
	span: RegexLiteralSpan,
	tokenStart: number,
	tokenEnd: number
): boolean {
	const overlap = Math.min(tokenEnd, span.endCol) - Math.max(tokenStart, span.startCol);
	if (overlap <= 0) return false;
	// A zero-width token can't be hovered; treat it as covered by the overlap.
	const tokenLength = Math.max(1, tokenEnd - tokenStart);
	return overlap * 2 >= tokenLength;
}

// Find the regex a hovered token belongs to, given the token's line and
// character range.
export function regexSpanAt(
	index: RegexLiteralIndex,
	line: number,
	tokenStart: number,
	tokenEnd: number
): RegexLiteralSpan | null {
	const spans = index.get(line);
	if (!spans) return null;
	for (const span of spans) {
		if (tokenBelongsToLiteral(span, tokenStart, tokenEnd)) return span;
	}
	return null;
}

// One short sentence owning up to a difference between the dialect the pattern
// was written for and the browser's `RegExp` that evaluates it, or null when
// there is none.
//
// Deliberately silent by default. The overwhelming majority of patterns mean the
// same thing in both engines, and a standing "results may vary" disclaimer on
// every non-JavaScript regex would be noise that trains people to ignore the one
// case that matters.
export function regexCompatibilityNote(span: RegexLiteralSpan): string | null {
	if (span.dialect === 'javascript') return null;
	return compatibilityNote(span.pattern, span.droppedOptions);
}
