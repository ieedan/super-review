// Which languages the regex tester understands, and how each one writes a
// regex. Everything here is data for the shared call scanner (see
// `regex-scan-call.ts`); JavaScript is the exception, having real regex
// literals and its own scanner.
//
// Adding a language means adding an entry here. The bar for one is that its
// regexes live in argument positions we can name, because that precision is
// what keeps every other string in the file inert.

import type { RegexCallSpec } from './regex-scan-call';

// Quote forms shared by the C-family languages: escapes, no newlines.
const DOUBLE: RegexCallSpec['quotes'][number] = { open: '"', close: '"' };
const SINGLE: RegexCallSpec['quotes'][number] = { open: "'", close: "'" };

export const REGEX_LANGUAGES: Record<string, RegexCallSpec> = {
	// C#. Regexes are strings passed to `Regex`, including the target-typed
	// `new(…)` form where the type sits on the declaration.
	csharp: {
		dialect: 'dotnet',
		lineComments: ['//'],
		blockComment: ['/*', '*/'],
		quotes: [
			{ open: '"""', close: '"""', raw: true },
			{ open: '$@"', close: '"', raw: true, doubled: true, multiline: true, skip: true },
			{ open: '@$"', close: '"', raw: true, doubled: true, multiline: true, skip: true },
			{ open: '$"', close: '"', skip: true },
			{ open: '@"', close: '"', raw: true, doubled: true, multiline: true },
			DOUBLE
		],
		sites: {
			'Regex.IsMatch': 1,
			'Regex.Match': 1,
			'Regex.Matches': 1,
			'Regex.Replace': 1,
			'Regex.Split': 1,
			'Regex.Count': 1,
			'Regex.EnumerateMatches': 1,
			// The two attribute forms, and their spelled-out `…Attribute` names.
			GeneratedRegex: 0,
			GeneratedRegexAttribute: 0,
			RegularExpression: 0,
			RegularExpressionAttribute: 0
		},
		newSites: { Regex: 0 },
		targetTypedNew: 'Regex',
		options: {
			token: /RegexOptions\s*\.\s*(\w+)/g,
			// .NET's Singleline is "dot matches newline", which is RegExp's `s`,
			// despite the names pointing opposite ways.
			flags: { IgnoreCase: 'i', Multiline: 'm', Singleline: 's' },
			changesMatching: ['IgnorePatternWhitespace', 'RightToLeft']
		}
	},

	// Python. Every `re` function takes the pattern first.
	python: {
		dialect: 'python',
		lineComments: ['#'],
		quotes: [
			{ open: 'r"""', close: '"""', raw: true, multiline: true },
			{ open: "r'''", close: "'''", raw: true, multiline: true },
			{ open: '"""', close: '"""', multiline: true },
			{ open: "'''", close: "'''", multiline: true },
			{ open: 'r"', close: '"', raw: true },
			{ open: "r'", close: "'", raw: true },
			{ open: 'f"', close: '"', skip: true },
			{ open: "f'", close: "'", skip: true },
			DOUBLE,
			SINGLE
		],
		sites: {
			're.compile': 0,
			're.match': 0,
			're.fullmatch': 0,
			're.search': 0,
			're.sub': 0,
			're.subn': 0,
			're.split': 0,
			're.findall': 0,
			're.finditer': 0
		},
		options: {
			token: /re\s*\.\s*([A-Z]+)/g,
			flags: { I: 'i', IGNORECASE: 'i', M: 'm', MULTILINE: 'm', S: 's', DOTALL: 's' },
			changesMatching: ['X', 'VERBOSE', 'A', 'ASCII', 'L', 'LOCALE']
		}
	},

	// Java. `Pattern`, plus the `String` methods that take a regex (which is all
	// of these: `split` on a Java string really is regex-based).
	java: {
		dialect: 'java',
		lineComments: ['//'],
		blockComment: ['/*', '*/'],
		quotes: [{ open: '"""', close: '"""', multiline: true }, DOUBLE],
		sites: {
			'Pattern.compile': 0,
			'Pattern.matches': 0,
			'.matches': 0,
			'.replaceAll': 0,
			'.replaceFirst': 0,
			'.split': 0
		},
		options: {
			token: /Pattern\s*\.\s*([A-Z_]+)/g,
			flags: { CASE_INSENSITIVE: 'i', MULTILINE: 'm', DOTALL: 's' },
			changesMatching: ['COMMENTS', 'LITERAL', 'UNIX_LINES']
		}
	},

	// Kotlin. `Regex(…)` is a constructor call without `new`. Deliberately not
	// the `String` methods: unlike Java, Kotlin's `split` and `replace` take
	// literal strings, so treating them as regexes would be wrong.
	kotlin: {
		dialect: 'java',
		lineComments: ['//'],
		blockComment: ['/*', '*/'],
		quotes: [{ open: '"""', close: '"""', raw: true, multiline: true }, DOUBLE],
		sites: { Regex: 0, 'Pattern.compile': 0 },
		options: {
			token: /RegexOption\s*\.\s*([A-Z_]+)/g,
			flags: { IGNORE_CASE: 'i', MULTILINE: 'm', DOT_MATCHES_ALL: 's' },
			changesMatching: ['COMMENTS', 'LITERAL']
		}
	},

	// Go. No flag arguments: RE2 sets them inline with `(?i)`, which the shared
	// normalisation lifts into RegExp flags.
	go: {
		dialect: 're2',
		lineComments: ['//'],
		blockComment: ['/*', '*/'],
		quotes: [{ open: '`', close: '`', raw: true, multiline: true }, DOUBLE],
		sites: {
			'regexp.MustCompile': 0,
			'regexp.Compile': 0,
			'regexp.MustCompilePOSIX': 0,
			'regexp.CompilePOSIX': 0,
			'regexp.MatchString': 0,
			'regexp.Match': 0
		}
	},

	// Rust. Same RE2 lineage as Go, and `::` reads as a chain separator.
	rust: {
		dialect: 're2',
		lineComments: ['//'],
		blockComment: ['/*', '*/'],
		quotes: [
			{ open: 'r##"', close: '"##', raw: true, multiline: true },
			{ open: 'r#"', close: '"#', raw: true, multiline: true },
			{ open: 'r"', close: '"', raw: true, multiline: true },
			DOUBLE
		],
		sites: { 'Regex.new': 0, 'RegexBuilder.new': 0, 'Regex.is_match': 0 }
	},

	// PHP. The pattern carries its own delimiters and modifiers inside the
	// string, `'/^\d+$/i'`, which `delimited` unwraps.
	php: {
		dialect: 'pcre',
		lineComments: ['//', '#'],
		blockComment: ['/*', '*/'],
		quotes: [DOUBLE, SINGLE],
		sites: {
			preg_match: 0,
			preg_match_all: 0,
			preg_replace: 0,
			preg_replace_callback: 0,
			preg_split: 0,
			preg_grep: 0,
			preg_quote: 0
		},
		delimited: true
	}
};

// File extension -> the language whose regexes it holds. `javascript` has its
// own scanner; everything else resolves to a `REGEX_LANGUAGES` entry.
//
// Deliberately not the template languages (`.svelte`, `.vue`, `.html`): the
// JavaScript scanner assumes JavaScript token rules and would read markup like
// `</div>` as the start of a regex.
export const REGEX_EXTENSIONS: Record<string, string> = {
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	ts: 'javascript',
	tsx: 'javascript',
	mts: 'javascript',
	cts: 'javascript',
	cs: 'csharp',
	csx: 'csharp',
	py: 'python',
	pyi: 'python',
	java: 'java',
	kt: 'kotlin',
	kts: 'kotlin',
	go: 'go',
	rs: 'rust',
	php: 'php'
};
