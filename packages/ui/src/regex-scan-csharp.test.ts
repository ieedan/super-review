import { describe, expect, it } from 'vitest';
import { dotnetCompatibilityNote, parseCSharpRegexLiterals } from './regex-scan-csharp';
import type { RegexLiteralSpan } from './regex-literals';

function spans(text: string): (RegexLiteralSpan & { line: number })[] {
	const out: (RegexLiteralSpan & { line: number })[] = [];
	for (const [line, found] of parseCSharpRegexLiterals(text)) {
		for (const span of found) out.push({ ...span, line });
	}
	return out.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
}

function patterns(text: string): string[] {
	return spans(text).map((s) => s.pattern);
}

describe('parseCSharpRegexLiterals: where a regex can appear', () => {
	it('finds the pattern of a Regex constructor', () => {
		expect(patterns('var re = new Regex("[a-z]+");')).toEqual(['[a-z]+']);
	});

	it('finds a target-typed new when the statement names Regex', () => {
		// The type is on the declaration, not the expression, which is how the
		// pattern in the report that prompted this support was written.
		const text = [
			'private static readonly Regex ParameterPattern =',
			'    new(@"(?<!@)@([A-Za-z_][A-Za-z0-9_]*)", RegexOptions.Compiled);'
		].join('\n');
		expect(patterns(text)).toEqual(['(?<!@)@([A-Za-z_][A-Za-z0-9_]*)']);
	});

	it('ignores a target-typed new with no Regex in the statement', () => {
		expect(patterns('private static readonly Thing T = new("not a pattern");')).toEqual([]);
	});

	it('does not carry a Regex mention across statements', () => {
		const text = ['var re = new Regex("a");', 'var other = new("b");'].join('\n');
		expect(patterns(text)).toEqual(['a']);
	});

	it('finds the second argument of the static Regex methods', () => {
		expect(patterns('if (Regex.IsMatch(input, "^y(es)?$")) { }')).toEqual(['^y(es)?$']);
		expect(patterns('var m = Regex.Match(input, "[0-9]+");')).toEqual(['[0-9]+']);
		expect(patterns('var s = Regex.Replace(input, "\\\\s+", " ");')).toEqual(['\\s+']);
		expect(patterns('var parts = Regex.Split(input, ",");')).toEqual([',']);
	});

	it('ignores the first argument of a static Regex method', () => {
		// The input is a string too, and it is not a pattern.
		expect(patterns('Regex.IsMatch("some input", "p");')).toEqual(['p']);
	});

	it('finds a fully qualified constructor', () => {
		expect(patterns('var re = new System.Text.RegularExpressions.Regex("x");')).toEqual(['x']);
	});

	it('finds the pattern in a GeneratedRegex attribute', () => {
		expect(patterns('[GeneratedRegex("^[a-z]+$")]\nprivate static partial Regex Slug();')).toEqual([
			'^[a-z]+$'
		]);
	});

	it('finds the pattern in a RegularExpression validation attribute', () => {
		expect(patterns('[RegularExpression(@"\\d{3}")]\npublic string Code { get; set; }')).toEqual([
			'\\d{3}'
		]);
	});

	it('ignores an instance method, which takes no pattern', () => {
		expect(patterns('if (parameterPattern.IsMatch("candidate")) { }')).toEqual([]);
	});

	it('ignores ordinary strings', () => {
		const text = [
			'var name = "Regex";',
			'Console.WriteLine("new Regex(\\"nope\\")");',
			'var sql = "SELECT * FROM x WHERE y = @p";'
		].join('\n');
		expect(patterns(text)).toEqual([]);
	});

	it('ignores strings in comments', () => {
		expect(patterns('// var re = new Regex("commented out");')).toEqual([]);
		expect(patterns('/* new Regex("also out") */')).toEqual([]);
	});

	it('records the line and the span covering the whole literal', () => {
		const line = 'var re = new Regex(@"\\d+");';
		const [span] = spans(line);
		expect(span.line).toBe(1);
		expect(line.slice(span.startCol, span.endCol)).toBe('@"\\d+"');
	});

	it('finds several regexes in one file', () => {
		const text = [
			'var a = new Regex("one");',
			'var b = Regex.IsMatch(s, "two");',
			'var c = new Regex("three");'
		].join('\n');
		expect(patterns(text)).toEqual(['one', 'two', 'three']);
	});
});

describe('parseCSharpRegexLiterals: string forms', () => {
	it('decodes escapes in a regular string', () => {
		// The pattern is the string's value, so the doubled backslashes collapse.
		expect(patterns('new Regex("\\\\d+\\\\.\\\\d+")')).toEqual(['\\d+\\.\\d+']);
	});

	it('decodes an escaped quote in a regular string', () => {
		expect(patterns('new Regex("\\"[^\\"]*\\"")')).toEqual(['"[^"]*"']);
	});

	it('decodes unicode escapes', () => {
		expect(patterns('new Regex("\\u00e9+")')).toEqual(['é+']);
	});

	it('keeps backslashes literal in a verbatim string', () => {
		expect(patterns('new Regex(@"\\d+\\s*")')).toEqual(['\\d+\\s*']);
	});

	it('reads a doubled quote in a verbatim string as one quote', () => {
		expect(patterns('new Regex(@"^""(.*)""$")')).toEqual(['^"(.*)"$']);
	});

	it('reads a single-line raw string literal', () => {
		expect(patterns('new Regex("""(?<year>\\d{4})-\\d{2}""")')).toEqual(['(?<year>\\d{4})-\\d{2}']);
	});

	it('skips an interpolated string, whose value is not static', () => {
		expect(patterns('new Regex($"^{prefix}-\\\\d+$")')).toEqual([]);
		expect(patterns('new Regex($@"^{prefix}")')).toEqual([]);
	});

	it('skips a multi-line verbatim string, which no single line can anchor', () => {
		const text = ['var re = new Regex(@"', '    \\d+', '    ");'].join('\n');
		expect(patterns(text)).toEqual([]);
	});

	it('keeps scanning correctly after a skipped string', () => {
		const text = ['var a = new Regex($"{x}");', 'var b = new Regex("after");'].join('\n');
		expect(patterns(text)).toEqual(['after']);
	});

	it('keeps scanning correctly after a quote inside a char literal', () => {
		const text = ["var q = '\"';", 'var b = new Regex("after");'].join('\n');
		expect(patterns(text)).toEqual(['after']);
	});
});

describe('parseCSharpRegexLiterals: RegexOptions', () => {
	it('translates the options that map onto RegExp flags', () => {
		expect(spans('new Regex("a", RegexOptions.IgnoreCase)')[0].flags).toBe('i');
		expect(spans('new Regex("a", RegexOptions.Multiline)')[0].flags).toBe('m');
		// .NET's Singleline is "dot matches newline", which is RegExp's `s`.
		expect(spans('new Regex("a", RegexOptions.Singleline)')[0].flags).toBe('s');
	});

	it('translates several combined options', () => {
		const [span] = spans('new Regex("a", RegexOptions.IgnoreCase | RegexOptions.Multiline)');
		expect(span.flags.split('').sort().join('')).toBe('im');
	});

	it('ignores options that do not change whether something matches', () => {
		const [span] = spans('new Regex("a", RegexOptions.Compiled | RegexOptions.CultureInvariant)');
		expect(span.flags).toBe('');
		expect(span.droppedOptions).toBeUndefined();
	});

	it('records options that change matching but have no equivalent', () => {
		const [span] = spans('new Regex("a b", RegexOptions.IgnorePatternWhitespace)');
		expect(span.droppedOptions).toEqual(['IgnorePatternWhitespace']);
	});

	it('reads options on an attribute too', () => {
		expect(spans('[GeneratedRegex("^a$", RegexOptions.IgnoreCase)]')[0].flags).toBe('i');
	});

	it('leaves flags empty when the options are not written inline', () => {
		expect(spans('new Regex("a", options)')[0].flags).toBe('');
	});

	it('does not leak options from a later, unrelated call', () => {
		const text = ['var a = new Regex("one");', 'Configure(RegexOptions.IgnoreCase);'].join('\n');
		expect(spans(text)[0].flags).toBe('');
	});
});

describe('dotnetCompatibilityNote', () => {
	function note(pattern: string, droppedOptions?: string[]): string | null {
		return dotnetCompatibilityNote({
			startCol: 0,
			endCol: 0,
			pattern,
			flags: '',
			source: '',
			dialect: 'dotnet',
			droppedOptions
		});
	}

	it('says nothing about a pattern both engines agree on', () => {
		// The common case by a wide margin, and a standing disclaimer here would
		// train people to ignore the notes that matter.
		expect(note('(?<!@)@([A-Za-z_][A-Za-z0-9_]*)')).toBeNull();
		expect(note('^\\d{3}-\\d{4}$')).toBeNull();
		expect(note('(?<year>\\d{4})')).toBeNull();
		expect(note('[a-z-]+')).toBeNull();
	});

	it('flags .NET-only anchors, which RegExp silently reads as literals', () => {
		// The dangerous case: `\A` matches a literal "A" here, so without a note
		// the popup would give a confident wrong answer.
		expect(note('\\Afoo\\z')).toContain('anchors');
		expect(note('\\Gfoo')).toContain('anchors');
	});

	it('does not mistake an escaped backslash for an anchor', () => {
		// `\\A` is a literal backslash followed by A, which both engines agree on.
		expect(note('\\\\Afoo')).toBeNull();
	});

	it('flags inline options', () => {
		expect(note('(?i)hello')).toContain('inline options');
		expect(note('(?im-sx:hello)')).toContain('inline options');
	});

	it('does not mistake an ordinary group for inline options', () => {
		expect(note('(?:hello)')).toBeNull();
		expect(note('(?=hello)')).toBeNull();
		expect(note('(?<!hello)')).toBeNull();
	});

	it('flags conditionals, comments and balancing groups', () => {
		expect(note('(?(1)yes|no)')).toContain('conditionals');
		expect(note('a(?#note)b')).toContain('comments');
		expect(note('(?<open>a)(?<close-open>b)')).toContain('balancing groups');
	});

	it('flags character-class subtraction', () => {
		expect(note('[a-z-[aeiou]]')).toContain('subtraction');
	});

	it('flags unicode categories, which need a flag the pattern cannot carry', () => {
		expect(note('\\p{Lu}+')).toContain('categories');
	});

	it('flags options that change matching with no equivalent', () => {
		expect(note('a b', ['IgnorePatternWhitespace'])).toContain('IgnorePatternWhitespace');
		expect(note('ab', ['RightToLeft'])).toContain('RightToLeft');
	});

	it('leads with the pattern construct when both apply', () => {
		// The construct usually stops the pattern compiling at all, so it explains
		// more of what the user is looking at than the option does.
		expect(note('(?i)a b', ['IgnorePatternWhitespace'])).toContain('inline options');
	});
});
