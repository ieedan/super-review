// Finds Ruby's regex literals: `/pattern/flags` and `%r{pattern}flags`.
//
// Ruby is the one language here besides JavaScript with a real regex literal,
// so it needs a scanner of the same shape: `/` is division about as often as it
// opens a regex, and telling them apart means tracking what came before. It is
// not shared with `regex-scan-js.ts` because almost nothing else lines up.
// Ruby comments with `#` and `=begin`, has percent literals and heredocs, and
// its `%` is modulo or a literal opener depending on the same context `/` is.
// Parameterising one loop to cover both would have been longer than two.
//
// `Regexp.new("…")` is not here: a string in a call is exactly what the shared
// call scanner already does, so the Ruby table lists it there.

import { addSpan, type RegexLiteralIndex } from './regex-literals';

// After these, a `/` can only open a regex. Anything else that ends in a value
// position (a variable, a literal, `)`) means division.
const KEYWORDS = new Set([
	'and',
	'begin',
	'break',
	'case',
	'do',
	'else',
	'elsif',
	'ensure',
	'if',
	'in',
	'next',
	'not',
	'or',
	'rescue',
	'return',
	'then',
	'unless',
	'until',
	'when',
	'while',
	'yield'
]);

// Ruby's flag letters. `m` is the interesting one: it means "dot matches
// newline", which is RegExp's `s`, not RegExp's `m`. `x` changes matching with
// no equivalent; `o` (compile once) and the encoding flags change nothing here.
const FLAG_CHARS = 'imxonesu';
const FLAG_MAP: Record<string, string> = { i: 'i', m: 's' };
const FLAGS_THAT_CHANGE_MATCHING = 'x';

// Bracket pairs a percent literal can nest; any other delimiter closes on its
// own repeat.
const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[\w?!]/;

// Split Ruby's flag letters into RegExp flags and the ones we have to own up to.
function translateFlags(raw: string): { flags: string; dropped: string[] } {
	let flags = '';
	const dropped: string[] = [];
	for (const ch of raw) {
		const mapped = FLAG_MAP[ch];
		if (mapped) {
			if (!flags.includes(mapped)) flags += mapped;
		} else if (FLAGS_THAT_CHANGE_MATCHING.includes(ch) && !dropped.includes(ch)) {
			dropped.push(ch);
		}
	}
	return { flags, dropped };
}

// Scan Ruby source and index every regex literal by line.
export function parseRubyRegexLiterals(text: string): RegexLiteralIndex {
	const index: RegexLiteralIndex = new Map();

	const n = text.length;
	let i = 0;
	let line = 1;
	let col = 0;
	// Whether the last significant token could end an expression. `/` and `%`
	// both divide after one and open a literal otherwise.
	let afterValue = false;

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

	// Record a literal running from `start` to `end` in the source, whose body is
	// `pattern` and whose flag letters follow it.
	const record = (
		start: number,
		startCol: number,
		startLine: number,
		pattern: string,
		raw: string,
		end: number
	): void => {
		const { flags, dropped } = translateFlags(raw);
		const span = {
			startCol,
			endCol: startCol + (end - start),
			pattern,
			flags,
			source: text.slice(start, end),
			dialect: 'ruby' as const,
			...(dropped.length > 0 ? { droppedOptions: dropped } : {})
		};
		addSpan(index, startLine, span);
	};

	// Read the body of a literal delimited by `close`, honouring `\` escapes,
	// `[…]` classes (where the delimiter is not special) and, for bracket pairs,
	// nesting. Returns the body and the index just past the closing delimiter, or
	// null when it doesn't close on this line.
	const readBody = (
		from: number,
		open: string,
		close: string
	): { body: string; end: number } | null => {
		const nests = open !== close;
		// `%r[…]` delimits with the same brackets a character class uses, so there
		// the depth count is the only thing that can close it.
		const tracksClass = close !== ']';
		let depth = 1;
		let inClass = false;
		let j = from;
		let body = '';
		while (j < n) {
			const ch = text[j];
			if (ch === '\n' || ch === undefined) return null;
			if (ch === '\\') {
				body += ch + (text[j + 1] ?? '');
				j += 2;
				continue;
			}
			if (tracksClass && (ch === '[' || ch === ']')) {
				inClass = ch === '[';
			} else if (!inClass) {
				if (nests && ch === open) {
					depth++;
				} else if (ch === close) {
					depth--;
					if (depth === 0) return { body, end: j + 1 };
				}
			}
			body += ch;
			j++;
		}
		return null;
	};

	// Consume the flag letters after a literal's closing delimiter.
	const readFlags = (from: number): { raw: string; end: number } => {
		let j = from;
		while (j < n && FLAG_CHARS.includes(text[j])) j++;
		return { raw: text.slice(from, j), end: j };
	};

	while (i < n) {
		const ch = text[i];

		if (ch === '\n') {
			line++;
			col = 0;
			i++;
			// A statement ends at the newline, so the next line starts fresh: a `/`
			// there opens a literal rather than dividing whatever came before.
			afterValue = false;
			continue;
		}

		if (ch === ' ' || ch === '\t' || ch === '\r') {
			i++;
			col++;
			continue;
		}

		if (ch === '#') {
			while (i < n && text[i] !== '\n') {
				i++;
				col++;
			}
			continue;
		}

		// `=begin` / `=end` block comments, which only count at the line start.
		if (ch === '=' && col === 0 && text.startsWith('=begin', i)) {
			const end = text.indexOf('\n=end', i);
			skipTo(end === -1 ? n : end + 1);
			while (i < n && text[i] !== '\n') {
				i++;
				col++;
			}
			continue;
		}

		// Heredocs. `<<~SQL`, `<<-SQL`, `<<SQL`, `<<~'SQL'`. Told apart from the
		// append operator by the tag following with no space, which is the
		// universal convention. The body is skipped whole: it is prose or SQL, and
		// scanning it as code would invent literals out of its slashes.
		if (ch === '<' && text[i + 1] === '<') {
			const heredoc = /^<<([~-]?)(['"]?)([A-Z_]\w*)\2/.exec(text.slice(i));
			if (heredoc) {
				const tag = heredoc[3];
				// The terminator is the tag alone on a line, indented only when the
				// heredoc was opened with `~` or `-`.
				const terminator = new RegExp(`\\n[ \\t]*${tag}[ \\t]*(\\n|$)`);
				const rest = text.slice(i);
				const at = terminator.exec(rest);
				skipTo(at ? i + at.index + at[0].length - 1 : n);
				afterValue = true;
				continue;
			}
		}

		// Strings. Their contents never hold a literal we want, so they are only
		// skipped, but `#{…}` interpolation can hold quotes of its own and has to
		// be stepped over as a unit.
		if (ch === '"' || ch === "'" || ch === '`') {
			const quote = ch;
			let j = i + 1;
			while (j < n && text[j] !== quote) {
				if (text[j] === '\\') {
					j += 2;
					continue;
				}
				if (quote !== "'" && text[j] === '#' && text[j + 1] === '{') {
					let depth = 1;
					j += 2;
					while (j < n && depth > 0) {
						if (text[j] === '{') depth++;
						else if (text[j] === '}') depth--;
						j++;
					}
					continue;
				}
				j++;
			}
			skipTo(Math.min(j + 1, n));
			afterValue = true;
			continue;
		}

		// `%r{…}` and the other percent literals. `%` after a value is modulo, the
		// same call `/` needs.
		if (ch === '%' && !afterValue) {
			const type = /[a-zA-Z]/.test(text[i + 1] ?? '') ? text[i + 1] : '';
			const openIndex = i + 1 + type.length;
			const open = text[openIndex] ?? '';
			// A delimiter is any punctuation; a letter or digit here means this was
			// something else entirely.
			if (open && !/[\sA-Za-z0-9]/.test(open)) {
				const close = PAIRS[open] ?? open;
				const read = readBody(openIndex + 1, open, close);
				if (read) {
					if (type === 'r') {
						const flags = readFlags(read.end);
						record(i, col, line, read.body, flags.raw, flags.end);
						skipTo(flags.end);
					} else {
						// Some other percent literal (`%w[…]`, `%q(…)`): skipped, not read.
						skipTo(read.end);
					}
					afterValue = true;
					continue;
				}
			}
		}

		if (ch === '/') {
			if (!afterValue) {
				const read = readBody(i + 1, '/', '/');
				if (read) {
					const flags = readFlags(read.end);
					record(i, col, line, read.body, flags.raw, flags.end);
					skipTo(flags.end);
					afterValue = true;
					continue;
				}
			}
			// Division, or a `/` we couldn't resolve into a literal.
			afterValue = false;
			i++;
			col++;
			continue;
		}

		if (IDENT_START.test(ch)) {
			const start = i;
			i++;
			col++;
			while (i < n && IDENT_PART.test(text[i])) {
				i++;
				col++;
			}
			const word = text.slice(start, i);
			// A symbol (`:foo`) or a keyword leaves a regex possible; anything else
			// is a value or a method whose result is one.
			afterValue = !KEYWORDS.has(word);
			continue;
		}

		if (ch >= '0' && ch <= '9') {
			while (i < n && /[\w.]/.test(text[i])) {
				i++;
				col++;
			}
			afterValue = true;
			continue;
		}

		// `)` and `]` close an expression; `}` more often ends a block than an
		// expression, and everything else is punctuation or an operator.
		afterValue = ch === ')' || ch === ']';
		i++;
		col++;
	}

	return index;
}
