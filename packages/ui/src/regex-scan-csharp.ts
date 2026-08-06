// Finds regexes in C#. Unlike JavaScript, C# has no regex literal: a pattern is
// an ordinary string that happens to be handed to `Regex`. So instead of looking
// for a syntax, this looks for a *position*, and a string only counts when it
// sits in one:
//
//   new Regex("…")                     // and target-typed `new("…")`
//   Regex.IsMatch(input, "…")          // pattern is the second argument
//   [GeneratedRegex("…")]              // and [RegularExpression("…")]
//
// Getting the position right is what keeps every other string in the file inert,
// which matters far more here than it did for JavaScript: a C# file is full of
// strings, and flagging them all as testable would be worse than no feature.
//
// The other half of the job is the string itself. The pattern is the string's
// *value*, not its source text, so `"\\d+"` has to be decoded to `\d+` before
// anything can run it. C# has several string forms and they decode differently
// (see `readString`).

import { addSpan, type RegexLiteralIndex, type RegexLiteralSpan } from './regex-literals';

// Static `Regex` members whose second argument is the pattern. Instance methods
// (`myRegex.IsMatch(s)`) take no pattern and are correctly not here.
const REGEX_STATIC_METHODS = new Set([
	'IsMatch',
	'Match',
	'Matches',
	'Replace',
	'Split',
	'Count',
	'EnumerateMatches',
	'EnumerateSplits'
]);

// Attributes whose first argument is a pattern. The `…Attribute` spellings are
// the same attributes written out in full, which C# allows.
const REGEX_ATTRIBUTES = new Set([
	'GeneratedRegex',
	'GeneratedRegexAttribute',
	'RegularExpression',
	'RegularExpressionAttribute'
]);

// `RegexOptions` members that map cleanly onto a `RegExp` flag. .NET's
// `Singleline` is "dot matches newline", which is exactly JavaScript's `s`
// (despite the names pointing opposite ways).
const OPTION_FLAGS: Record<string, string> = {
	IgnoreCase: 'i',
	Multiline: 'm',
	Singleline: 's'
};

// `RegexOptions` members with no `RegExp` equivalent that genuinely change
// whether something matches, so the popup can own up to them. Options that only
// affect capture groups (`ExplicitCapture`) or performance (`Compiled`,
// `NonBacktracking`) are dropped silently, because the answer is the same.
const OPTIONS_THAT_CHANGE_MATCHING = new Set(['IgnorePatternWhitespace', 'RightToLeft']);

const IDENT_START = /[A-Za-z_@]/;
const IDENT_PART = /[\w]/;

// An open `(` and what we know about the call it belongs to.
interface CallFrame {
	// The dotted identifier chain immediately before the `(`, e.g. `Regex.IsMatch`
	// or `GeneratedRegex`. Empty for a target-typed `new(`.
	callee: string;
	// Whether `new` introduced this call.
	isNew: boolean;
	// Which argument the scanner is currently inside, 0-based.
	argIndex: number;
	// The span recorded for this call's pattern argument, so the `RegexOptions`
	// in a later argument can be folded into its flags when the call closes.
	patternSpan: RegexLiteralSpan | null;
	// Source offset just past the pattern argument, where the options scan starts.
	patternEnd: number;
}

// Which argument of this call is the pattern, or null when this call takes none.
function patternArgIndex(frame: CallFrame, statementNamesRegex: boolean): number | null {
	const segments = frame.callee.split('.').filter(Boolean);
	const last = segments[segments.length - 1] ?? '';

	if (frame.isNew) {
		// `new Regex(…)`, or fully qualified as
		// `new System.Text.RegularExpressions.Regex(…)`.
		if (last === 'Regex') return 0;
		// Target-typed `new(…)`, where the type is on the declaration rather than
		// the expression:  `private static readonly Regex P = new(@"…");`
		// The statement having named `Regex` at all is the only evidence available
		// without type resolution, and it's enough in practice.
		if (segments.length === 0 && statementNamesRegex) return 0;
		return null;
	}

	if (REGEX_ATTRIBUTES.has(last)) return 0;
	if (segments[segments.length - 2] === 'Regex' && REGEX_STATIC_METHODS.has(last)) return 1;
	return null;
}

// A string literal read from the source.
interface ScannedString {
	// The decoded value, which is what the engine would receive.
	value: string;
	// Source offset just past the closing quote.
	end: number;
	// False when we can read where the string ends but not what it means: an
	// interpolated string (the value isn't static) or one spanning several lines
	// (the index is per line, and half a pattern is worse than none). The scanner
	// still has to skip it correctly, hence "where" without "what".
	supported: boolean;
}

// Decode one escape sequence starting at the backslash in `text[i]`.
function readEscape(text: string, i: number): { value: string; end: number } {
	const ch = text[i + 1];
	switch (ch) {
		case '\\':
		case '"':
		case "'":
			return { value: ch, end: i + 2 };
		case '0':
			return { value: '\0', end: i + 2 };
		case 'a':
			return { value: '\x07', end: i + 2 };
		case 'b':
			return { value: '\b', end: i + 2 };
		case 'f':
			return { value: '\f', end: i + 2 };
		case 'n':
			return { value: '\n', end: i + 2 };
		case 'r':
			return { value: '\r', end: i + 2 };
		case 't':
			return { value: '\t', end: i + 2 };
		case 'v':
			return { value: '\v', end: i + 2 };
		case 'u':
		case 'x':
		case 'U': {
			// \uXXXX and \UXXXXXXXX are fixed width; \x takes 1 to 4 digits.
			const width = ch === 'u' ? 4 : ch === 'U' ? 8 : 4;
			let digits = '';
			let j = i + 2;
			while (digits.length < width && /[0-9a-fA-F]/.test(text[j] ?? '')) {
				digits += text[j];
				j++;
			}
			if (digits.length === 0) return { value: `\\${ch}`, end: i + 2 };
			return { value: String.fromCodePoint(Number.parseInt(digits, 16)), end: j };
		}
		default:
			// Not a valid C# escape. The compiler would reject it, but a diff can
			// hold anything: keep it verbatim rather than guessing.
			return { value: ch === undefined ? '\\' : `\\${ch}`, end: i + 2 };
	}
}

// Read the string literal starting at `i`, whatever form it takes, or null when
// `i` isn't the start of one. Always reports where the string ends so the
// scanner stays in sync even for forms it can't evaluate.
function readString(text: string, i: number): ScannedString | null {
	const n = text.length;

	// Prefixes: `@` (verbatim), `$` (interpolated), and both in either order.
	let j = i;
	let verbatim = false;
	let interpolated = false;
	while (j < n && (text[j] === '@' || text[j] === '$')) {
		if (text[j] === '@') verbatim = true;
		else interpolated = true;
		j++;
	}
	if (text[j] !== '"') return null;

	// Raw string literals open with three or more quotes and close with a run of
	// the same length. No escapes at all inside, which is why they're popular for
	// regexes.
	let quotes = 0;
	while (text[j + quotes] === '"') quotes++;
	if (quotes >= 3) {
		const open = j + quotes;
		const closer = '"'.repeat(quotes);
		const at = text.indexOf(closer, open);
		if (at === -1) return { value: '', end: n, supported: false };
		const body = text.slice(open, at);
		// A multi-line raw string has its own indentation-stripping rules and
		// wouldn't fit the per-line index anyway.
		const supported = !interpolated && !body.includes('\n');
		return { value: body, end: at + quotes, supported };
	}

	j++; // past the opening quote

	if (verbatim) {
		// Verbatim: backslashes are literal and `""` is an escaped quote. May span
		// lines, which we skip over but can't index.
		let value = '';
		let multiline = false;
		while (j < n) {
			const ch = text[j];
			if (ch === '"') {
				if (text[j + 1] === '"') {
					value += '"';
					j += 2;
					continue;
				}
				j++;
				return { value, end: j, supported: !interpolated && !multiline };
			}
			if (ch === '\n') multiline = true;
			value += ch;
			j++;
		}
		return { value, end: n, supported: false };
	}

	// Regular string: backslash escapes, and it cannot contain a raw newline.
	let value = '';
	while (j < n) {
		const ch = text[j];
		if (ch === '\\') {
			const esc = readEscape(text, j);
			value += esc.value;
			j = esc.end;
			continue;
		}
		if (ch === '"') {
			j++;
			return { value, end: j, supported: !interpolated };
		}
		if (ch === '\n') {
			// Unterminated (a broken line in a working-tree diff). Stop here so the
			// scanner resynchronises on the next line instead of eating the file.
			return { value, end: j, supported: false };
		}
		value += ch;
		j++;
	}
	return { value, end: n, supported: false };
}

// Fold the `RegexOptions` in a call's remaining arguments into the pattern's
// flags. Reading them off the source text is enough: they're written as
// `RegexOptions.X | RegexOptions.Y` at the call site virtually always, and an
// options value we can't see just leaves the flags empty.
function applyOptions(span: RegexLiteralSpan, optionsText: string): void {
	let flags = '';
	const dropped: string[] = [];
	for (const match of optionsText.matchAll(/RegexOptions\s*\.\s*(\w+)/g)) {
		const name = match[1];
		const flag = OPTION_FLAGS[name];
		if (flag) {
			if (!flags.includes(flag)) flags += flag;
		} else if (OPTIONS_THAT_CHANGE_MATCHING.has(name) && !dropped.includes(name)) {
			dropped.push(name);
		}
	}
	span.flags = flags;
	if (dropped.length > 0) span.droppedOptions = dropped;
}

// Scan C# source and index every regex by line.
export function parseCSharpRegexLiterals(text: string): RegexLiteralIndex {
	const index: RegexLiteralIndex = new Map();

	const n = text.length;
	let i = 0;
	let line = 1;
	let col = 0;

	// The dotted identifier chain most recently read, which becomes the callee of
	// the next `(`.
	let chain = '';
	// Whether `new` was the last keyword read, so `new Regex(` and `Regex(` are
	// told apart.
	let pendingNew = false;
	// Whether the statement in progress mentions `Regex` anywhere, which is what
	// makes a target-typed `new(…)` recognisable.
	let statementNamesRegex = false;
	// The last non-whitespace character, so `a.b` chains but `a + b` doesn't.
	let lastChar = '';
	const frames: CallFrame[] = [];

	// Advance to `to`, keeping the line/column counters honest across whatever
	// was skipped (strings and comments can span lines).
	function skipTo(to: number): void {
		for (let k = i; k < to && k < n; k++) {
			if (text[k] === '\n') {
				line++;
				col = 0;
			} else {
				col++;
			}
		}
		i = Math.min(to, n);
	}

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

		if (ch === '/' && text[i + 1] === '/') {
			while (i < n && text[i] !== '\n') {
				i++;
				col++;
			}
			continue;
		}

		if (ch === '/' && text[i + 1] === '*') {
			const close = text.indexOf('*/', i + 2);
			skipTo(close === -1 ? n : close + 2);
			continue;
		}

		if (ch === "'") {
			// Character literal. Skipped only so its contents (`'"'`) can't be
			// mistaken for the start of a string.
			let j = i + 1;
			while (j < n && text[j] !== "'" && text[j] !== '\n') {
				j += text[j] === '\\' ? 2 : 1;
			}
			skipTo(j + 1);
			lastChar = "'";
			chain = '';
			continue;
		}

		// A string, possibly the pattern of the call we're inside.
		if (ch === '"' || ((ch === '@' || ch === '$') && /["@$]/.test(text[i + 1] ?? ''))) {
			const startCol = col;
			const startLine = line;
			const startIndex = i;
			const scanned = readString(text, i);
			if (!scanned) {
				i++;
				col++;
				continue;
			}
			skipTo(scanned.end);

			const frame = frames[frames.length - 1];
			if (scanned.supported && frame) {
				const wanted = patternArgIndex(frame, statementNamesRegex);
				if (wanted != null && wanted === frame.argIndex && !frame.patternSpan) {
					const span: RegexLiteralSpan = {
						startCol,
						endCol: col,
						pattern: scanned.value,
						flags: '',
						source: text.slice(startIndex, scanned.end),
						dialect: 'dotnet'
					};
					addSpan(index, startLine, span);
					// Options arrive in a later argument; remember where to look when
					// this call closes.
					frame.patternSpan = span;
					frame.patternEnd = scanned.end;
				}
			}
			lastChar = '"';
			chain = '';
			continue;
		}

		if (IDENT_START.test(ch)) {
			// `@` also prefixes a verbatim identifier (`@class`); the string case
			// above already claimed `@"`.
			const start = i;
			i++;
			col++;
			while (i < n && IDENT_PART.test(text[i])) {
				i++;
				col++;
			}
			const word = text.slice(start, i);
			if (word === 'new') {
				pendingNew = true;
				chain = '';
			} else {
				chain = lastChar === '.' ? `${chain}.${word}` : word;
				if (word === 'Regex') statementNamesRegex = true;
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
			if (frame?.patternSpan) {
				// Everything between the pattern and here is the remaining arguments,
				// which is where `RegexOptions` lives.
				applyOptions(frame.patternSpan, text.slice(frame.patternEnd, i));
			}
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
			// A new statement: the `Regex` mention that would license a target-typed
			// `new(…)` doesn't carry across one.
			statementNamesRegex = false;
			chain = '';
			pendingNew = false;
			lastChar = ch;
			i++;
			col++;
			continue;
		}

		if (ch !== '.') chain = '';
		lastChar = ch;
		i++;
		col++;
	}

	return index;
}

// Constructs .NET supports that the browser's `RegExp` does not, paired with
// what to say about each. Two flavours, and the difference matters:
//
//   - `RegExp` *throws* on most of them, so the popup already shows an error;
//     the note's job is to explain that the pattern is fine and the engine isn't.
//   - `\A` and friends are worse: `RegExp` reads `\A` as a literal "A" and
//     silently returns a confidently wrong answer. Those are the reason this
//     function exists at all.
const DOTNET_ONLY_NOTES: Record<string, string> = {
	anchor:
		'Uses .NET anchors like \\A or \\z, which the browser engine here reads as literal characters.',
	unicodeCategory:
		'Uses \\p{…} categories, which need a flag the browser engine only takes on its own patterns.',
	inlineOptions:
		'Uses .NET inline options like (?i), which the browser engine here has no syntax for.',
	comment: 'Uses .NET (?#…) comments, which the browser engine here has no syntax for.',
	conditional:
		'Uses .NET conditionals like (?(name)…), which the browser engine here cannot express.',
	balancingGroup:
		'Uses .NET balancing groups like (?<a-b>…), which the browser engine here cannot express.',
	classSubtraction:
		'Uses .NET character-class subtraction like [a-z-[aeiou]], which the browser engine here cannot express.'
};

const DROPPED_OPTION_NOTES: Record<string, string> = {
	IgnorePatternWhitespace:
		'RegexOptions.IgnorePatternWhitespace has no equivalent here, so whitespace in the pattern counts.',
	RightToLeft: 'RegexOptions.RightToLeft has no equivalent here, so this searches left to right.'
};

// The first .NET-only construct in `pattern`, or null. Walks the pattern rather
// than testing it with regexes of our own, so an escaped `\\A` (a literal
// backslash followed by A) isn't mistaken for the `\A` anchor.
function dotnetOnlyConstruct(pattern: string): string | null {
	let inClass = false;
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];

		if (ch === '\\') {
			const next = pattern[i + 1] ?? '';
			if ('AZzG'.includes(next)) return 'anchor';
			if (next === 'p' || next === 'P') return 'unicodeCategory';
			i++;
			continue;
		}

		if (inClass) {
			// `[a-z-[aeiou]]`: a nested `[` after a `-` is subtraction.
			if (ch === '-' && pattern[i + 1] === '[') return 'classSubtraction';
			if (ch === ']') inClass = false;
			continue;
		}

		if (ch === '[') {
			inClass = true;
			continue;
		}

		if (ch === '(' && pattern[i + 1] === '?') {
			const rest = pattern.slice(i + 2);
			if (rest.startsWith('#')) return 'comment';
			if (rest.startsWith('(')) return 'conditional';
			// `(?<name-other>…)` balances; `(?<name>…)` is an ordinary named group
			// that JavaScript has too.
			if (/^<[A-Za-z_][\w]*-/.test(rest)) return 'balancingGroup';
			// `(?i)`, `(?im-sx:…)`. Distinguished from `(?:…)` by needing at least
			// one option letter before the `)` or `:`.
			if (/^[imnsx]+-?[imnsx]*[):]/.test(rest)) return 'inlineOptions';
		}
	}
	return null;
}

// The compatibility note for a .NET pattern, or null when it means the same
// thing in both engines (which is the common case).
export function dotnetCompatibilityNote(span: RegexLiteralSpan): string | null {
	const construct = dotnetOnlyConstruct(span.pattern);
	if (construct) return DOTNET_ONLY_NOTES[construct];
	for (const option of span.droppedOptions ?? []) {
		const note = DROPPED_OPTION_NOTES[option];
		if (note) return note;
	}
	return null;
}
