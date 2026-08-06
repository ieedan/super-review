import { describe, expect, it } from 'vitest';
import { REGEX_LANGUAGES } from './regex-languages';
import { scanRegexCalls } from './regex-scan-call';
import type { RegexLiteralSpan } from './regex-literals';

function spans(language: string, text: string): (RegexLiteralSpan & { line: number })[] {
	const out: (RegexLiteralSpan & { line: number })[] = [];
	for (const [line, found] of scanRegexCalls(REGEX_LANGUAGES[language], text)) {
		for (const span of found) out.push({ ...span, line });
	}
	return out.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
}

// The patterns a language's scanner finds, which is what nearly every case here
// asserts: the right strings, decoded, and nothing else.
function patterns(language: string, text: string): string[] {
	return spans(language, text).map((s) => s.pattern);
}

describe('C#', () => {
	it('finds the pattern of a Regex constructor', () => {
		expect(patterns('csharp', 'var re = new Regex("[a-z]+");')).toEqual(['[a-z]+']);
	});

	it('finds a target-typed new when the statement names Regex', () => {
		// The type is on the declaration, not the expression, which is how the
		// pattern in the report that prompted this support was written.
		const text = [
			'private static readonly Regex ParameterPattern =',
			'    new(@"(?<!@)@([A-Za-z_][A-Za-z0-9_]*)", RegexOptions.Compiled);'
		].join('\n');
		expect(patterns('csharp', text)).toEqual(['(?<!@)@([A-Za-z_][A-Za-z0-9_]*)']);
	});

	it('ignores a target-typed new with no Regex in the statement', () => {
		expect(patterns('csharp', 'private static readonly Thing T = new("not a pattern");')).toEqual(
			[]
		);
	});

	it('does not carry a Regex mention across statements', () => {
		const text = ['var re = new Regex("a");', 'var other = new("b");'].join('\n');
		expect(patterns('csharp', text)).toEqual(['a']);
	});

	it('finds the second argument of the static Regex methods', () => {
		expect(patterns('csharp', 'if (Regex.IsMatch(input, "^y(es)?$")) { }')).toEqual(['^y(es)?$']);
		expect(patterns('csharp', 'var s = Regex.Replace(input, "\\\\s+", " ");')).toEqual(['\\s+']);
	});

	it('ignores the first argument of a static Regex method', () => {
		// The input is a string too, and it is not a pattern.
		expect(patterns('csharp', 'Regex.IsMatch("some input", "p");')).toEqual(['p']);
	});

	it('finds a fully qualified constructor', () => {
		expect(patterns('csharp', 'var re = new System.Text.RegularExpressions.Regex("x");')).toEqual([
			'x'
		]);
	});

	it('finds the pattern in the attributes', () => {
		expect(patterns('csharp', '[GeneratedRegex("^[a-z]+$")]')).toEqual(['^[a-z]+$']);
		expect(patterns('csharp', '[RegularExpression(@"\\d{3}")]')).toEqual(['\\d{3}']);
	});

	it('ignores an instance method, which takes no pattern', () => {
		expect(patterns('csharp', 'if (parameterPattern.IsMatch("candidate")) { }')).toEqual([]);
	});

	it('ignores ordinary strings', () => {
		const text = [
			'var name = "Regex";',
			'var sql = "SELECT * FROM x WHERE y = @p";',
			'// var re = new Regex("commented out");',
			'/* new Regex("also out") */'
		].join('\n');
		expect(patterns('csharp', text)).toEqual([]);
	});

	it('decodes escapes, verbatim strings and raw strings', () => {
		expect(patterns('csharp', 'new Regex("\\\\d+\\\\.\\\\d+")')).toEqual(['\\d+\\.\\d+']);
		expect(patterns('csharp', 'new Regex("\\"[^\\"]*\\"")')).toEqual(['"[^"]*"']);
		expect(patterns('csharp', 'new Regex(@"\\d+\\s*")')).toEqual(['\\d+\\s*']);
		expect(patterns('csharp', 'new Regex(@"^""(.*)""$")')).toEqual(['^"(.*)"$']);
		expect(patterns('csharp', 'new Regex("""(?<y>\\d{4})""")')).toEqual(['(?<y>\\d{4})']);
	});

	it('skips interpolated and multi-line strings', () => {
		expect(patterns('csharp', 'new Regex($"^{prefix}-\\\\d+$")')).toEqual([]);
		expect(patterns('csharp', ['var re = new Regex(@"', '  \\d+', '  ");'].join('\n'))).toEqual([]);
	});

	it('keeps scanning correctly after a skipped string', () => {
		const text = ['var a = new Regex($"{x}");', 'var b = new Regex("after");'].join('\n');
		expect(patterns('csharp', text)).toEqual(['after']);
	});

	it('translates RegexOptions', () => {
		expect(spans('csharp', 'new Regex("a", RegexOptions.IgnoreCase)')[0].flags).toBe('i');
		// .NET's Singleline is "dot matches newline", which is RegExp's `s`.
		expect(spans('csharp', 'new Regex("a", RegexOptions.Singleline)')[0].flags).toBe('s');
		const both = spans(
			'csharp',
			'new Regex("a", RegexOptions.IgnoreCase | RegexOptions.Multiline)'
		);
		expect(both[0].flags.split('').sort().join('')).toBe('im');
	});

	it('ignores options that do not change whether something matches', () => {
		const [span] = spans(
			'csharp',
			'new Regex("a", RegexOptions.Compiled | RegexOptions.CultureInvariant)'
		);
		expect(span.flags).toBe('');
		expect(span.droppedOptions).toBeUndefined();
	});

	it('records options that change matching but have no equivalent', () => {
		const [span] = spans('csharp', 'new Regex("a b", RegexOptions.IgnorePatternWhitespace)');
		expect(span.droppedOptions).toEqual(['IgnorePatternWhitespace']);
	});

	it('does not leak options from a later, unrelated call', () => {
		const text = ['var a = new Regex("one");', 'Configure(RegexOptions.IgnoreCase);'].join('\n');
		expect(spans('csharp', text)[0].flags).toBe('');
	});

	it('records the span covering the whole literal', () => {
		const line = 'var re = new Regex(@"\\d+");';
		const [span] = spans('csharp', line);
		expect(line.slice(span.startCol, span.endCol)).toBe('@"\\d+"');
	});
});

describe('Python', () => {
	it('finds the first argument of the re functions', () => {
		expect(patterns('python', 'PATTERN = re.compile(r"^\\d{4}-\\d{2}$")')).toEqual([
			'^\\d{4}-\\d{2}$'
		]);
		expect(patterns('python', 'if re.match(r"^y(es)?$", answer):')).toEqual(['^y(es)?$']);
		expect(patterns('python', 'clean = re.sub(r"\\s+", " ", raw)')).toEqual(['\\s+']);
		expect(patterns('python', 'parts = re.split(r",\\s*", line)')).toEqual([',\\s*']);
	});

	it('keeps backslashes literal in a raw string and decodes them otherwise', () => {
		expect(patterns('python', 're.compile(r"\\d+")')).toEqual(['\\d+']);
		expect(patterns('python', 're.compile("\\\\d+")')).toEqual(['\\d+']);
	});

	it('reads single quotes and triple quotes', () => {
		expect(patterns('python', "re.compile(r'^[a-z]+$')")).toEqual(['^[a-z]+$']);
		expect(patterns('python', 're.compile(r"""^[a-z]+$""")')).toEqual(['^[a-z]+$']);
	});

	it('skips f-strings, whose value is not static', () => {
		expect(patterns('python', 're.compile(f"^{prefix}")')).toEqual([]);
	});

	it('ignores ordinary strings and comments', () => {
		const text = [
			'name = "re.compile"',
			'# re.compile(r"commented")',
			'url = "https://example.com/a"',
			'print("no regex here")'
		].join('\n');
		expect(patterns('python', text)).toEqual([]);
	});

	it('ignores a compiled pattern’s own methods, which take no pattern', () => {
		expect(patterns('python', 'PATTERN.match("candidate")')).toEqual([]);
	});

	it('translates the re flags', () => {
		expect(spans('python', 're.compile(r"a", re.IGNORECASE)')[0].flags).toBe('i');
		expect(spans('python', 're.compile(r"a", re.I)')[0].flags).toBe('i');
		expect(spans('python', 're.compile(r"a", re.DOTALL)')[0].flags).toBe('s');
		expect(spans('python', 're.match(r"a", s, re.M)')[0].flags).toBe('m');
	});

	it('records VERBOSE, which changes matching with no equivalent', () => {
		expect(spans('python', 're.compile(r"a b", re.VERBOSE)')[0].droppedOptions).toEqual([
			'VERBOSE'
		]);
	});
});

describe('Java', () => {
	it('finds Pattern.compile and the String methods that take a regex', () => {
		expect(patterns('java', 'Pattern p = Pattern.compile("^\\\\d+$");')).toEqual(['^\\d+$']);
		expect(patterns('java', 'if (input.matches("[a-z]+")) { }')).toEqual(['[a-z]+']);
		expect(patterns('java', 'String s = raw.replaceAll("\\\\s+", " ");')).toEqual(['\\s+']);
		expect(patterns('java', 'String[] parts = line.split(",\\\\s*");')).toEqual([',\\s*']);
	});

	it('ignores the replacement argument, which is not a regex', () => {
		expect(patterns('java', 'raw.replaceAll("a", "b");')).toEqual(['a']);
	});

	it('ignores ordinary strings', () => {
		expect(patterns('java', 'String label = "Pattern.compile";')).toEqual([]);
		expect(patterns('java', 'log.info("nothing to see");')).toEqual([]);
	});

	it('translates the Pattern flags', () => {
		expect(spans('java', 'Pattern.compile("a", Pattern.CASE_INSENSITIVE)')[0].flags).toBe('i');
		expect(spans('java', 'Pattern.compile("a", Pattern.DOTALL)')[0].flags).toBe('s');
	});
});

describe('Kotlin', () => {
	it('finds the Regex constructor, which takes no new', () => {
		expect(patterns('kotlin', 'val re = Regex("^[a-z]+$")')).toEqual(['^[a-z]+$']);
	});

	it('leaves the String methods alone, since they take literal delimiters', () => {
		// Unlike Java, Kotlin's split and replace are not regex-based.
		expect(patterns('kotlin', 'val parts = line.split(",")')).toEqual([]);
		expect(patterns('kotlin', 'val s = raw.replace("a", "b")')).toEqual([]);
	});

	it('translates the RegexOption flags', () => {
		expect(spans('kotlin', 'Regex("a", RegexOption.IGNORE_CASE)')[0].flags).toBe('i');
	});
});

describe('Go', () => {
	it('finds the regexp functions', () => {
		expect(patterns('go', 'var re = regexp.MustCompile(`^\\d+$`)')).toEqual(['^\\d+$']);
		expect(patterns('go', 'ok, _ := regexp.MatchString("^a", s)')).toEqual(['^a']);
	});

	it('keeps backslashes literal in a backtick string', () => {
		expect(patterns('go', 'regexp.MustCompile(`\\s+`)')).toEqual(['\\s+']);
		expect(patterns('go', 'regexp.MustCompile("\\\\s+")')).toEqual(['\\s+']);
	});

	it('reads an inline flag group as written', () => {
		// The scanner only finds; lifting `(?i)` into a real flag is normalisation,
		// which belongs to every language and so lives in the dispatcher (see
		// regex-literals.test.ts).
		expect(patterns('go', 'regexp.MustCompile(`(?i)^hello$`)')).toEqual(['(?i)^hello$']);
	});

	it('ignores ordinary strings', () => {
		expect(patterns('go', 'fmt.Println("regexp.MustCompile")')).toEqual([]);
	});
});

describe('Rust', () => {
	it('finds Regex::new, with :: reading as a chain separator', () => {
		expect(patterns('rust', 'let re = Regex::new(r"^\\d+$").unwrap();')).toEqual(['^\\d+$']);
	});

	it('reads hashed raw strings', () => {
		expect(patterns('rust', 'Regex::new(r#"^"(.*)"$"#)')).toEqual(['^"(.*)"$']);
	});

	it('ignores ordinary strings', () => {
		expect(patterns('rust', 'println!("Regex::new");')).toEqual([]);
	});
});

describe('PHP', () => {
	it('unwraps the delimiters the pattern carries', () => {
		const [span] = spans('php', "preg_match('/^\\d+$/', $s);");
		expect(span.pattern).toBe('^\\d+$');
		expect(span.flags).toBe('');
	});

	it('reads the modifiers after the closing delimiter as flags', () => {
		expect(spans('php', "preg_match('/^a$/i', $s);")[0].flags).toBe('i');
		expect(spans('php', "preg_match('/^a$/ims', $s);")[0].flags.split('').sort().join('')).toBe(
			'ims'
		);
	});

	it('accepts the bracket delimiters too', () => {
		expect(spans('php', "preg_match('{^/usr/.*$}', $path);")[0].pattern).toBe('^/usr/.*$');
		expect(spans('php', 'preg_match("~^a~", $s);')[0].pattern).toBe('^a');
	});

	it('records modifiers that change matching with no equivalent', () => {
		expect(spans('php', "preg_match('/a b/x', $s);")[0].droppedOptions).toEqual(['x']);
	});

	it('finds the other preg functions', () => {
		expect(spans('php', "preg_replace('/\\s+/', ' ', $raw);")[0].pattern).toBe('\\s+');
		expect(spans('php', "preg_split('/,/', $line);")[0].pattern).toBe(',');
	});

	it('ignores a string that is not delimited after all', () => {
		// Guards against reading an ordinary argument as a pattern.
		expect(patterns('php', "preg_match('not a pattern', $s);")).toEqual([]);
	});

	it('ignores ordinary strings and comments', () => {
		const text = ['$label = "preg_match";', "# preg_match('/a/', $s);", '// and this one'].join(
			'\n'
		);
		expect(patterns('php', text)).toEqual([]);
	});
});

describe('shared behaviour', () => {
	it('records the line each regex is on', () => {
		const text = ['import re', '', 'A = re.compile(r"one")', 'B = re.compile(r"two")'].join('\n');
		expect(spans('python', text).map((s) => [s.line, s.pattern])).toEqual([
			[3, 'one'],
			[4, 'two']
		]);
	});

	it('finds several regexes on one line, in order', () => {
		expect(patterns('python', 're.sub(r"a", "", re.sub(r"b", "", s))')).toEqual(['a', 'b']);
	});

	it('carries the language dialect on every span', () => {
		expect(spans('python', 're.compile(r"a")')[0].dialect).toBe('python');
		expect(spans('go', 'regexp.MustCompile(`a`)')[0].dialect).toBe('re2');
		expect(spans('php', "preg_match('/a/', $s);")[0].dialect).toBe('pcre');
	});

	it('recovers on the next line after an unterminated string', () => {
		const text = ['A = re.compile(r"oops', 'B = re.compile(r"good")'].join('\n');
		expect(patterns('python', text)).toEqual(['good']);
	});

	it('handles an empty file', () => {
		expect(scanRegexCalls(REGEX_LANGUAGES.python, '').size).toBe(0);
	});
});
