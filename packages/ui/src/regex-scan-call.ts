// One scanner for every language whose regexes are strings rather than
// literals, which is every language here except JavaScript.
//
// They all share a shape: a regex is a string literal sitting in a known
// argument of a known call (`re.compile(…)`, `Pattern.compile(…)`,
// `regexp.MustCompile(…)`, `new Regex(…)`, `preg_match(…)`). So the scanner is
// written once and each language contributes a table (see `regex-languages.ts`)
// saying which calls those are and how it spells a string. Adding a language is
// a dozen lines of data, not another scanner.
//
// Matching the *position* is what keeps every other string in the file inert,
// which is the whole game: these files are full of strings, and lighting them
// all up would be worse than no feature.

import { normalizeInlineFlags } from './regex-compat';
import {
	addSpan,
	type RegexDialect,
	type RegexLiteralIndex,
	type RegexLiteralSpan
} from './regex-literals';

// How one flavour of string literal is written. Forms are tried longest-opener
// first, so `"""` wins over `"` and `r"` over `"`.
export interface QuoteForm {
	// The opening delimiter, prefix included: `"`, `'''`, `r"`, `@"`, `` ` ``.
	open: string;
	// The closing delimiter.
	close: string;
	// No escape decoding: the value is the source text (Python `r"…"`, Go
	// backticks, Rust `r"…"`, C# `@"…"`).
	raw?: boolean;
	// A doubled closing delimiter means a literal one (C# `@"…""…"`).
	doubled?: boolean;
	// May contain newlines. Without this a newline ends the string, which is how
	// an unterminated line in a half-typed diff resynchronises.
	multiline?: boolean;
	// Recognised so the scanner can step over it, but never a pattern: an
	// interpolated string has no value until it runs.
	skip?: boolean;
}

export interface RegexCallSpec {
	dialect: RegexDialect;
	lineComments: string[];
	blockComment?: [string, string];
	quotes: QuoteForm[];
	// Callee -> which argument holds the pattern, 0-based. A key matches the
	// call's dotted name exactly or as a suffix (`Regex.IsMatch` matches
	// `System.Text.RegularExpressions.Regex.IsMatch`); a leading dot matches on
	// the method name alone, for calls on any receiver (`.replaceAll`).
	sites: Record<string, number>;
	// The same, for calls introduced by `new`.
	newSites?: Record<string, number>;
	// The type whose name in a statement licenses a target-typed `new(…)`, where
	// the type sits on the declaration rather than the expression.
	targetTypedNew?: string;
	// Flag constants named in the call's later arguments, e.g. `RegexOptions.X`
	// or `re.X`. `flags` maps the ones with a RegExp equivalent; `changesMatching`
	// lists those without one that still change the answer, so the popup can own
	// up to them. Anything unlisted is dropped silently, because it doesn't
	// change whether something matches.
	options?: {
		token: RegExp;
		flags: Record<string, string>;
		changesMatching?: string[];
	};
	// The pattern string carries its own delimiters and modifiers, PHP style:
	// `'/^\d+$/i'`. Unwrapped after decoding.
	delimited?: boolean;
}

// An open `(` and what we know about the call it belongs to.
interface CallFrame {
	// The dotted name before the `(`, `::` normalised to `.`. Empty for a
	// target-typed `new(`.
	callee: string;
	isNew: boolean;
	argIndex: number;
	// The span recorded for this call's pattern, so flag arguments that come
	// later can be folded into it when the call closes.
	patternSpan: RegexLiteralSpan | null;
	patternEnd: number;
}

// Which argument of this call holds the pattern, or null when it holds none.
function patternArgIndex(
	spec: RegexCallSpec,
	frame: CallFrame,
	statementNamesType: boolean
): number | null {
	const sites = frame.isNew ? spec.newSites : spec.sites;
	if (frame.isNew && frame.callee === '') {
		// Target-typed `new(…)`. The statement naming the type at all is the only
		// evidence available without resolving types, and it is enough in practice.
		return spec.targetTypedNew && statementNamesType ? 0 : null;
	}
	if (!sites) return null;

	const last = frame.callee.split('.').pop() ?? '';
	for (const [key, argIndex] of Object.entries(sites)) {
		if (key.startsWith('.')) {
			if (last === key.slice(1)) return argIndex;
		} else if (frame.callee === key || frame.callee.endsWith(`.${key}`)) {
			return argIndex;
		}
	}
	return null;
}

// Decode one C-style escape. Every language here spells escapes this way, and
// where they differ it doesn't matter to a regex: PHP's single-quoted `'\n'` is
// a literal backslash-n rather than a newline, but both match a newline.
function readEscape(text: string, i: number): { value: string; end: number } {
	const ch = text[i + 1];
	if (ch === undefined) return { value: '\\', end: i + 2 };
	const simple: Record<string, string> = {
		'\\': '\\',
		'"': '"',
		"'": "'",
		'`': '`',
		'0': '\0',
		a: '\x07',
		b: '\b',
		f: '\f',
		n: '\n',
		r: '\r',
		t: '\t',
		v: '\v'
	};
	if (ch in simple) return { value: simple[ch], end: i + 2 };
	if (ch === 'u' || ch === 'x' || ch === 'U') {
		const width = ch === 'U' ? 8 : 4;
		let digits = '';
		let j = i + 2;
		while (digits.length < width && /[0-9a-fA-F]/.test(text[j] ?? '')) {
			digits += text[j];
			j++;
		}
		if (digits.length === 0) return { value: `\\${ch}`, end: i + 2 };
		return { value: String.fromCodePoint(Number.parseInt(digits, 16)), end: j };
	}
	// Not an escape any of these languages define. A regex escape like `\d` lands
	// here and must survive untouched, which is exactly what the compiler would
	// do with it too.
	return { value: `\\${ch}`, end: i + 2 };
}

interface ScannedString {
	value: string;
	end: number;
	// False when we can tell where the string ends but not what it means: an
	// interpolated one, or one spanning lines (the index is per line, and half a
	// pattern is worse than none). The scanner steps over it either way.
	supported: boolean;
}

// Read the string starting at `i`, or null when no form opens there. `quotes`
// arrives sorted longest-opener-first, so `"""` wins over `"` and `r"` over `"`.
function readString(quotes: QuoteForm[], text: string, i: number): ScannedString | null {
	const form = quotes.find((q) => text.startsWith(q.open, i));
	if (!form) return null;

	const n = text.length;
	let j = i + form.open.length;
	let value = '';
	let crossedLine = false;

	while (j < n) {
		if (text.startsWith(form.close, j)) {
			if (form.doubled && text.startsWith(form.close, j + form.close.length)) {
				value += form.close;
				j += form.close.length * 2;
				continue;
			}
			j += form.close.length;
			return { value, end: j, supported: !form.skip && !crossedLine };
		}
		const ch = text[j];
		if (ch === '\n') {
			if (!form.multiline) return { value, end: j, supported: false };
			crossedLine = true;
			value += ch;
			j++;
			continue;
		}
		if (ch === '\\' && !form.raw) {
			const esc = readEscape(text, j);
			value += esc.value;
			j = esc.end;
			continue;
		}
		// A raw string still can't end mid-escape, so a backslash before the
		// closing delimiter doesn't escape it: nothing special to do here.
		value += ch;
		j++;
	}
	return { value, end: n, supported: false };
}

// PHP writes the delimiters and modifiers inside the string: `'/^\d+$/i'`.
// Returns the pattern and the RegExp flags, or null when it isn't delimited
// after all (which means the call wasn't what we thought).
function unwrapDelimited(
	value: string
): { pattern: string; flags: string; dropped: string[] } | null {
	const open = value[0];
	if (!open || /[\sa-zA-Z0-9\\]/.test(open)) return null;
	const close =
		({ '(': ')', '[': ']', '{': '}', '<': '>' } as Record<string, string>)[open] ?? open;
	const end = value.lastIndexOf(close);
	if (end <= 0) return null;
	const modifiers = value.slice(end + 1);
	if (!/^[a-zA-Z]*$/.test(modifiers)) return null;

	let flags = '';
	const dropped: string[] = [];
	for (const modifier of modifiers) {
		// PCRE's i/m/s/u line up with RegExp; x (extended), A (anchored) and U
		// (ungreedy) change the answer with no equivalent, and the rest (D, S, …)
		// don't change it at all.
		if ('imsu'.includes(modifier)) {
			if (!flags.includes(modifier)) flags += modifier;
		} else if ('xAU'.includes(modifier) && !dropped.includes(modifier)) {
			dropped.push(modifier);
		}
	}
	return { pattern: value.slice(1, end), flags, dropped };
}

// Fold the flag constants in a call's later arguments into the pattern's flags.
// Reading them off the source is enough: they're written at the call site
// virtually always, and a value we can't see just leaves the flags empty.
function applyOptions(spec: RegexCallSpec, span: RegexLiteralSpan, argsText: string): void {
	const options = spec.options;
	if (!options) return;
	const dropped = [...(span.droppedOptions ?? [])];
	let flags = span.flags;
	for (const match of argsText.matchAll(options.token)) {
		const name = match[1];
		const flag = options.flags[name];
		if (flag) {
			if (!flags.includes(flag)) flags += flag;
		} else if (options.changesMatching?.includes(name) && !dropped.includes(name)) {
			dropped.push(name);
		}
	}
	span.flags = flags;
	if (dropped.length > 0) span.droppedOptions = dropped;
}

const IDENT = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

// Scan a source file and index every regex by line.
export function scanRegexCalls(spec: RegexCallSpec, text: string): RegexLiteralIndex {
	const index: RegexLiteralIndex = new Map();

	// Longest opener first, so a form can't be shadowed by a shorter one that
	// happens to be listed earlier.
	const quotes = [...spec.quotes].sort((a, b) => b.open.length - a.open.length);

	const n = text.length;
	let i = 0;
	let line = 1;
	let col = 0;
	// The dotted name most recently read, which becomes the callee of the next `(`.
	let chain = '';
	// Whether `new` was the last word read, so `new Regex(` and `Regex(` differ.
	let pendingNew = false;
	// Whether the statement in progress names the target-typed `new` type.
	let statementNamesType = false;
	// The last non-whitespace character, so `a.b` chains but `a + b` doesn't.
	let lastChar = '';
	const frames: CallFrame[] = [];

	// Advance to `to`, keeping the line/column counters honest across whatever
	// was skipped (strings and comments can span lines).
	const skipTo = (to: number): void => {
		for (let k = i; k < to && k < n; k++) {
			if (text[k] === '\n') {
				line++;
				col = 0;
			} else {
				col++;
			}
		}
		i = Math.min(to, n);
	};

	while (i < n) {
		const ch = text[i];

		if (ch === '\n') {
			line++;
			col = 0;
			i++;
			continue;
		}
		if (ch === ' ' || ch === '\t' || ch === '\r') {
			i++;
			col++;
			continue;
		}

		// A string first: its opener may start with a letter (`r"…"`) that the
		// identifier branch below would otherwise swallow.
		const scanned = readString(quotes, text, i);
		if (scanned) {
			const startCol = col;
			const startLine = line;
			const start = i;
			skipTo(scanned.end);

			const frame = frames[frames.length - 1];
			if (scanned.supported && frame && !frame.patternSpan) {
				const wanted = patternArgIndex(spec, frame, statementNamesType);
				if (wanted === frame.argIndex) {
					const unwrapped = spec.delimited ? unwrapDelimited(scanned.value) : null;
					if (!spec.delimited || unwrapped) {
						// A leading `(?i)` becomes a real flag: it is how the RE2
						// languages spell flags at all, so leaving it in the pattern would
						// fail to compile here for no good reason.
						const normalized = normalizeInlineFlags(
							unwrapped ? unwrapped.pattern : scanned.value,
							unwrapped ? unwrapped.flags : ''
						);
						const span: RegexLiteralSpan = {
							startCol,
							endCol: col,
							pattern: normalized.pattern,
							flags: normalized.flags,
							source: text.slice(start, scanned.end),
							dialect: spec.dialect
						};
						if (unwrapped && unwrapped.dropped.length > 0) span.droppedOptions = unwrapped.dropped;
						addSpan(index, startLine, span);
						frame.patternSpan = span;
						frame.patternEnd = scanned.end;
					}
				}
			}
			lastChar = '"';
			chain = '';
			continue;
		}

		const lineComment = spec.lineComments.find((c) => text.startsWith(c, i));
		if (lineComment) {
			while (i < n && text[i] !== '\n') {
				i++;
				col++;
			}
			continue;
		}

		if (spec.blockComment && text.startsWith(spec.blockComment[0], i)) {
			const close = text.indexOf(spec.blockComment[1], i + spec.blockComment[0].length);
			skipTo(close === -1 ? n : close + spec.blockComment[1].length);
			continue;
		}

		if (IDENT.test(ch)) {
			const start = i;
			i++;
			col++;
			while (i < n && IDENT_PART.test(text[i])) {
				i++;
				col++;
			}
			const word = text.slice(start, i);
			// `new` introduces a call only where the language says so. In Rust it is
			// an ordinary method name (`Regex::new`), and swallowing it as a keyword
			// would lose the callee entirely.
			if (word === 'new' && (spec.newSites || spec.targetTypedNew)) {
				pendingNew = true;
				chain = '';
			} else {
				chain = lastChar === '.' ? `${chain}.${word}` : word;
				if (word === spec.targetTypedNew) statementNamesType = true;
			}
			lastChar = word[word.length - 1];
			continue;
		}

		if (ch === '(') {
			frames.push({
				callee: chain,
				isNew: pendingNew,
				argIndex: 0,
				patternSpan: null,
				patternEnd: 0
			});
			chain = '';
			pendingNew = false;
			lastChar = ch;
			i++;
			col++;
			continue;
		}

		if (ch === ')') {
			const frame = frames.pop();
			// Everything between the pattern and here is the later arguments, which
			// is where the flag constants live.
			if (frame?.patternSpan)
				applyOptions(spec, frame.patternSpan, text.slice(frame.patternEnd, i));
			chain = '';
			lastChar = ch;
			i++;
			col++;
			continue;
		}

		if (ch === ',') {
			const frame = frames[frames.length - 1];
			if (frame) frame.argIndex++;
			chain = '';
			lastChar = ch;
			i++;
			col++;
			continue;
		}

		if (ch === ';' || ch === '{' || ch === '}') {
			// A new statement: the type mention that licenses a target-typed `new(…)`
			// doesn't carry across one.
			statementNamesType = false;
			chain = '';
			pendingNew = false;
			lastChar = ch;
			i++;
			col++;
			continue;
		}

		// `::` (Rust, PHP) reads as a chain separator, same as `.`.
		if (ch === ':' && text[i + 1] === ':') {
			lastChar = '.';
			i += 2;
			col += 2;
			continue;
		}

		if (ch !== '.') chain = '';
		lastChar = ch;
		i++;
		col++;
	}

	return index;
}
