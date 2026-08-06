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
// `Regexp.new("…")` is here too, rather than going through the shared call
// scanner. That scanner finds strings in calls for the languages whose regexes
// only ever appear that way, and it does not know `=begin` blocks, heredocs,
// `%q(…)` or `#{…}` interpolation. Pointing it at Ruby source would read a
// `Regexp.new("…")` inside a heredoc or a comment as real. Ruby's own scanner
// already steps over all of those correctly, so the few lines to spot the call
// belong here.

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

// Calls whose first argument is a pattern string.
const PATTERN_CALLS = new Set(['Regexp.new', 'Regexp.union', 'Regexp.escape']);

// `Regexp::IGNORECASE` and friends, read off the rest of the call. Ruby's
// MULTILINE is "dot matches newline", the same rename its `/m` flag carries.
const CONSTANT_FLAGS: Record<string, string> = { IGNORECASE: 'i', MULTILINE: 's' };

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[\w?!]/;

// Decode a Ruby string body. Single quotes only escape the quote and the
// backslash; double quotes take the usual C-style set. Either way a regex
// escape like `\d` has to survive untouched.
function decodeString(body: string, quote: string): string {
	const simple: Record<string, string> =
		quote === "'"
			? { '\\': '\\', "'": "'" }
			: { '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t', 0: '\0', e: '\x1b', s: ' ' };
	let out = '';
	for (let i = 0; i < body.length; i++) {
		if (body[i] === '\\' && i + 1 < body.length) {
			const next = body[i + 1];
			out += next in simple ? simple[next] : `\\${next}`;
			i++;
			continue;
		}
		out += body[i];
	}
	return out;
}

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
	// The dotted name most recently read, and whether the string coming next is
	// the first argument of a call that takes a pattern.
	let chain = '';
	let expectPattern = false;

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
	): { body: string; end: number; interpolated: boolean } | null => {
		const nests = open !== close;
		// `%r[…]` delimits with the same brackets a character class uses, so there
		// the depth count is the only thing that can close it.
		const tracksClass = close !== ']';
		let depth = 1;
		let inClass = false;
		let j = from;
		let body = '';
		let interpolated = false;
		while (j < n) {
			const ch = text[j];
			if (ch === '\n' || ch === undefined) return null;
			if (ch === '\\') {
				body += ch + (text[j + 1] ?? '');
				j += 2;
				continue;
			}
			// `/#{prefix}\d+/` has no pattern until it runs, so it can't be tested.
			if (ch === '#' && text[j + 1] === '{') interpolated = true;
			if (tracksClass && (ch === '[' || ch === ']')) {
				inClass = ch === '[';
			} else if (!inClass) {
				if (nests && ch === open) {
					depth++;
				} else if (ch === close) {
					depth--;
					if (depth === 0) return { body, end: j + 1, interpolated };
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
			const startCol = col;
			const startLine = line;
			const start = i;
			let interpolated = false;
			let j = i + 1;
			while (j < n && text[j] !== quote) {
				if (text[j] === '\\') {
					j += 2;
					continue;
				}
				if (quote !== "'" && text[j] === '#' && text[j + 1] === '{') {
					// Interpolation: no pattern until it runs, and it can hold quotes of
					// its own, so step over it as a unit.
					interpolated = true;
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
			const end = Math.min(j + 1, n);
			if (expectPattern && !interpolated && quote !== '`') {
				// Flags arrive as constants later in the call; the call is on one line
				// virtually always, so that is as far as this looks.
				const lineEnd = text.indexOf('\n', end);
				const tail = text.slice(end, lineEnd === -1 ? n : lineEnd);
				let flags = '';
				for (const match of tail.matchAll(/Regexp::([A-Z]+)/g)) {
					const flag = CONSTANT_FLAGS[match[1]];
					if (flag && !flags.includes(flag)) flags += flag;
				}
				const pattern = decodeString(text.slice(start + 1, end - 1), quote);
				addSpan(index, startLine, {
					startCol,
					endCol: startCol + (end - start),
					pattern,
					flags,
					source: text.slice(start, end),
					dialect: 'ruby',
					...(/Regexp::EXTENDED/.test(tail) ? { droppedOptions: ['x'] } : {})
				});
			}
			skipTo(end);
			expectPattern = false;
			chain = '';
			afterValue = true;
			continue;
		}

		// `%r{…}` and the other percent literals. A bare `%(…)` is only a literal
		// where a value can't already have ended, since otherwise it is modulo. A
		// *typed* one (`%r{…}`, `%w[…]`, `%q(…)`) is unambiguous anywhere: the
		// reading as modulo would need a method called `r`, `w` or `q`. That
		// matters beyond `%r`, because failing to recognise `%q(a/b/c)` leaves its
		// slashes to be read as a regex.
		if (ch === '%') {
			const type = /[qQwWiIrsx]/.test(text[i + 1] ?? '') ? text[i + 1] : '';
			const openIndex = i + 1 + type.length;
			const open = text[openIndex] ?? '';
			// A delimiter is any punctuation; a letter or digit here means this was
			// something else entirely.
			if ((type !== '' || !afterValue) && open && !/[\sA-Za-z0-9]/.test(open)) {
				const close = PAIRS[open] ?? open;
				const read = readBody(openIndex + 1, open, close);
				if (read) {
					if (type === 'r') {
						const flags = readFlags(read.end);
						if (!read.interpolated) record(i, col, line, read.body, flags.raw, flags.end);
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
					if (!read.interpolated) record(i, col, line, read.body, flags.raw, flags.end);
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
			// `Regexp.new` and friends reach here as two words joined by the `.` (or
			// `::`) the catch-all below records.
			chain = chain.endsWith('.') ? chain + word : word;
			expectPattern = false;
			// A keyword leaves a regex possible; anything else is a value, or a
			// method whose result is one.
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

		if (ch === '(') {
			expectPattern = PATTERN_CALLS.has(chain);
			chain = '';
			afterValue = false;
			i++;
			col++;
			continue;
		}

		// `.` and `::` continue a dotted name; anything else ends it.
		if (ch === '.') {
			chain += '.';
		} else if (ch === ':' && text[i + 1] === ':') {
			chain += '.';
			i += 2;
			col += 2;
			afterValue = false;
			continue;
		} else {
			chain = '';
			expectPattern = false;
		}

		// `)` and `]` close an expression; `}` more often ends a block than an
		// expression, and everything else is punctuation or an operator.
		afterValue = ch === ')' || ch === ']';
		i++;
		col++;
	}

	return index;
}
