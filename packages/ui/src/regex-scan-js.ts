// Finds JavaScript/TypeScript regex literals (`/pattern/flags`) in a source
// file, indexed by line and character range so the diff viewer can map a hovered
// token onto one. Mirrors `package-json-deps.ts`, which does the same job for
// package.json dependency entries.
//
// It's a hand-rolled scanner rather than a real parser because the file in a
// working-tree diff may not parse at all (half-typed code), and because we only
// need source positions, not an AST. The scanner degrades gracefully: anything
// it can't classify simply doesn't become a regex literal.
//
// The hard part is that `/` is ambiguous in JavaScript: it starts a regex in
// some positions and is division in others. Resolving that needs to know what
// came before, which means tracking strings, template literals and comments as
// we go, and classifying the last significant token (see `PrevToken`).

import { addSpan, type RegexLiteralIndex, type RegexLiteralSpan } from './regex-literals';

// The flag letters a regex literal may carry. Used to bound the flag scan: only
// these characters are consumed after the closing slash, so `/re/g.test(x)`
// stops at the `.` and `1/2/g` (were it ever read as a literal) can't swallow
// an identifier. Invalid *combinations* (e.g. `ug`, duplicate letters) are left
// to `RegExp` to reject, which surfaces as the popup's error state.
const FLAG_CHARS = 'dgimsuvy';

// Keywords after which a `/` can only start a regex, never divide. Anything else
// that ends in an identifier position (a variable, `this`, a literal) means the
// `/` is division.
const REGEX_PRECEDING_KEYWORDS = new Set([
	'await',
	'case',
	'delete',
	'do',
	'else',
	'in',
	'instanceof',
	'new',
	'of',
	'return',
	'throw',
	'typeof',
	'void',
	'yield'
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

function isDigit(ch: string): boolean {
	return ch >= '0' && ch <= '9';
}

// What the last significant token was, which is all we need to disambiguate a
// following `/`. `value` means the token could end an expression (identifier,
// number, string, `)`, `]`, or a regex literal), so `/` divides. Everything
// else (operators, `(`, `,`, `=`, `{`, `}`, a regex-permitting keyword, or the
// very start of the file) means `/` starts a regex.
type PrevToken = 'value' | 'other';

// The result of trying to read a regex literal at `start`.
interface ScannedLiteral {
	span: RegexLiteralSpan;
	// Index just past the literal in the source text.
	end: number;
	// Columns advanced, so the caller can keep its column counter in step.
	endCol: number;
}

// Try to read a complete regex literal beginning at the `/` at `start`.
// Returns null when it isn't one after all: an unterminated literal, or one
// that would run past the end of the line (a regex literal can't contain a raw
// newline, so `a / b` followed by `c / d` on the next line isn't a match).
function scanLiteral(text: string, start: number, startCol: number): ScannedLiteral | null {
	const n = text.length;
	// Inside a `[...]` character class a `/` is literal, so it doesn't close the
	// regex (`/[/]/` is a valid one-character class).
	let inClass = false;
	let i = start + 1;
	let col = startCol + 1;

	while (i < n) {
		const ch = text[i];
		if (ch === '\\') {
			// An escape consumes the next character whatever it is, unless the line
			// ends first (in which case this was never a literal).
			if (i + 1 >= n || text[i + 1] === '\n') return null;
			i += 2;
			col += 2;
			continue;
		}
		if (ch === '\n') return null;
		if (ch === '[') inClass = true;
		else if (ch === ']') inClass = false;
		else if (ch === '/' && !inClass) {
			const pattern = text.slice(start + 1, i);
			// An empty pattern would be `//`, which the caller already routed to the
			// line-comment branch, so `pattern` is always non-empty here.
			i++;
			col++;
			const flagStart = i;
			while (i < n && FLAG_CHARS.includes(text[i])) {
				i++;
				col++;
			}
			const flags = text.slice(flagStart, i);
			return {
				span: {
					startCol,
					endCol: col,
					pattern,
					flags,
					source: `/${pattern}/${flags}`,
					// The literal is JavaScript's own, so the browser's RegExp is
					// exactly the engine the code will run under: nothing to warn about.
					dialect: 'javascript'
				},
				end: i,
				endCol: col
			};
		}
		i++;
		col++;
	}
	return null;
}

// Scan JS/TS source and index every regex literal by line. `text` is the full
// contents of one side of the diff (old or new); the caller keys the result by
// which side the hovered token reported.
export function parseJsRegexLiterals(text: string): RegexLiteralIndex {
	const index: RegexLiteralIndex = new Map();

	const n = text.length;
	let i = 0;
	let line = 1;
	let col = 0;
	let prev: PrevToken = 'other';

	// Template literals interleave with ordinary code through `${ ... }`, so the
	// scanner tracks brace depth and remembers the depth at each open `${`. When
	// a `}` closes back down to that depth we're inside the template again rather
	// than in code. Without this, a `/` inside `` `${a / b}` `` would be read
	// against the wrong context.
	let braceDepth = 0;
	const templateBraces: number[] = [];
	// True while scanning the literal-text portion of a template.
	let inTemplate = false;

	while (i < n) {
		const ch = text[i];

		if (inTemplate) {
			if (ch === '\\') {
				// Escapes inside a template can span a newline (`\<newline>`), so keep
				// the line counter honest rather than blindly skipping two characters.
				if (text[i + 1] === '\n') {
					line++;
					col = 0;
					i += 2;
				} else {
					i += 2;
					col += 2;
				}
				continue;
			}
			if (ch === '\n') {
				line++;
				col = 0;
				i++;
				continue;
			}
			if (ch === '`') {
				inTemplate = false;
				prev = 'value';
				i++;
				col++;
				continue;
			}
			if (ch === '$' && text[i + 1] === '{') {
				// Back to ordinary code until the matching `}`.
				inTemplate = false;
				templateBraces.push(braceDepth);
				braceDepth++;
				prev = 'other';
				i += 2;
				col += 2;
				continue;
			}
			i++;
			col++;
			continue;
		}

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

		if (ch === '/') {
			const next = text[i + 1];
			if (next === '/') {
				// Line comment: everything to the newline, which the loop then handles.
				while (i < n && text[i] !== '\n') {
					i++;
					col++;
				}
				continue;
			}
			if (next === '*') {
				// Block comment, possibly spanning lines.
				i += 2;
				col += 2;
				while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
					if (text[i] === '\n') {
						line++;
						col = 0;
					} else {
						col++;
					}
					i++;
				}
				i += 2;
				col += 2;
				continue;
			}
			if (prev !== 'value') {
				const scanned = scanLiteral(text, i, col);
				if (scanned) {
					addSpan(index, line, scanned.span);
					i = scanned.end;
					col = scanned.endCol;
					// A regex literal is a value, so a following `/` divides it.
					prev = 'value';
					continue;
				}
			}
			// Division (or `/=`), or a `/` we couldn't resolve into a literal.
			prev = 'other';
			i++;
			col++;
			continue;
		}

		if (ch === '"' || ch === "'") {
			// String literal. JS strings can't contain a raw newline, but a broken
			// one in a working-tree diff might, so bail at the newline and let the
			// outer loop resynchronise instead of consuming the rest of the file.
			const quote = ch;
			i++;
			col++;
			while (i < n && text[i] !== quote && text[i] !== '\n') {
				if (text[i] === '\\') {
					i += 2;
					col += 2;
					continue;
				}
				i++;
				col++;
			}
			if (text[i] === quote) {
				i++;
				col++;
			}
			prev = 'value';
			continue;
		}

		if (ch === '`') {
			inTemplate = true;
			i++;
			col++;
			continue;
		}

		if (ch === '{') {
			braceDepth++;
			prev = 'other';
			i++;
			col++;
			continue;
		}

		if (ch === '}') {
			if (
				templateBraces.length > 0 &&
				templateBraces[templateBraces.length - 1] === braceDepth - 1
			) {
				// This `}` closes a `${ ... }`, so the template's text resumes.
				templateBraces.pop();
				braceDepth--;
				inTemplate = true;
				i++;
				col++;
				continue;
			}
			if (braceDepth > 0) braceDepth--;
			// A `}` ends a block far more often than it ends an object literal that's
			// about to be divided, so treat it as regex-permitting.
			prev = 'other';
			i++;
			col++;
			continue;
		}

		if (IDENT_START.test(ch)) {
			const start = i;
			while (i < n && IDENT_PART.test(text[i])) {
				i++;
				col++;
			}
			const word = text.slice(start, i);
			prev = REGEX_PRECEDING_KEYWORDS.has(word) ? 'other' : 'value';
			continue;
		}

		if (isDigit(ch)) {
			// Numeric literal, including `0x…`, exponents and separators. The exact
			// grammar doesn't matter, only that it ends as a value.
			while (i < n && (IDENT_PART.test(text[i]) || text[i] === '.')) {
				i++;
				col++;
			}
			prev = 'value';
			continue;
		}

		// `)` and `]` close an expression, so a following `/` divides. Everything
		// else is punctuation or an operator, after which a regex can start.
		prev = ch === ')' || ch === ']' ? 'value' : 'other';
		i++;
		col++;
	}

	return index;
}
