import { describe, expect, it } from 'vitest';
import { parseRubyRegexLiterals } from './regex-scan-ruby';
import { parseRegexLiterals } from './regex-literals';
import type { RegexLiteralSpan } from './regex-literals';

function spans(text: string): (RegexLiteralSpan & { line: number })[] {
	const out: (RegexLiteralSpan & { line: number })[] = [];
	for (const [line, found] of parseRubyRegexLiterals(text)) {
		for (const span of found) out.push({ ...span, line });
	}
	return out.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
}

function patterns(text: string): string[] {
	return spans(text).map((s) => s.pattern);
}

describe('parseRubyRegexLiterals: literals', () => {
	it('finds a literal assigned to a constant', () => {
		expect(patterns('SLUG = /[a-z0-9-]+/')).toEqual(['[a-z0-9-]+']);
	});

	it('finds literals in the idiomatic call positions', () => {
		expect(patterns('if line =~ /^ERROR/')).toEqual(['^ERROR']);
		expect(patterns('text.gsub(/\\s+/, " ")')).toEqual(['\\s+']);
		expect(patterns('parts = line.split(/,\\s*/)')).toEqual([',\\s*']);
		expect(patterns('when /^y(es)?$/')).toEqual(['^y(es)?$']);
		expect(patterns('return /ok/.match?(s)')).toEqual(['ok']);
	});

	it('reads the flags, mapping m to dot-matches-newline', () => {
		// Ruby's `m` is RegExp's `s`; its `^`/`$` are already line anchors.
		expect(spans('/a/i')[0].flags).toBe('i');
		expect(spans('/a/m')[0].flags).toBe('s');
		expect(spans('/a/im')[0].flags.split('').sort().join('')).toBe('is');
	});

	it('ignores o, which only affects when the literal is built', () => {
		expect(spans('/a/o')[0].flags).toBe('');
		expect(spans('/a/o')[0].droppedOptions).toBeUndefined();
	});

	it('records x, which changes matching with no equivalent', () => {
		expect(spans('/a b/x')[0].droppedOptions).toEqual(['x']);
	});

	it('does not end a literal on a slash inside a character class', () => {
		expect(patterns('SEP = /[/\\\\]+/')).toEqual(['[/\\\\]+']);
	});

	it('treats an escaped slash as part of the pattern', () => {
		expect(patterns('PATH = /a\\/b/')).toEqual(['a\\/b']);
	});
});

describe('parseRubyRegexLiterals: division vs regex', () => {
	it('reads a slash after a value as division', () => {
		expect(patterns('ratio = width / height')).toEqual([]);
		expect(patterns('avg = total / count / 2')).toEqual([]);
		expect(patterns('n = (a + b) / 2')).toEqual([]);
		expect(patterns('n = xs[0] / 2')).toEqual([]);
	});

	it('reads a slash after a keyword or operator as a literal', () => {
		expect(patterns('x = cond ? /yes/ : /no/')).toEqual(['yes', 'no']);
		expect(patterns('list = [/^a/, /b$/i]')).toEqual(['^a', 'b$']);
	});

	it('starts each line fresh, since a statement ends there', () => {
		const text = ['count = 10', 'SLUG = /[a-z]+/'].join('\n');
		expect(patterns(text)).toEqual(['[a-z]+']);
	});
});

describe('parseRubyRegexLiterals: percent literals', () => {
	it('finds %r with any delimiter', () => {
		expect(patterns('RE = %r{^/usr/.*$}')).toEqual(['^/usr/.*$']);
		expect(patterns('RE = %r[a-z]')).toEqual(['a-z']);
		expect(patterns('RE = %r!^a$!')).toEqual(['^a$']);
	});

	it('reads flags after the closing delimiter', () => {
		expect(spans('RE = %r{^a$}i')[0].flags).toBe('i');
	});

	it('allows nested brackets in a bracket-delimited literal', () => {
		expect(patterns('RE = %r{a{2,3}b}')).toEqual(['a{2,3}b']);
	});

	it('finds a typed percent literal even where a value could have ended', () => {
		// `puts %r{…}` is a command argument, not modulo. Ruby itself leans on the
		// spacing here; a typed literal is unambiguous enough to take either way.
		expect(patterns('puts %r{^a$}')).toEqual(['^a$']);
	});

	it('leaves the other percent literals alone', () => {
		expect(patterns('WORDS = %w[one two]')).toEqual([]);
		expect(patterns('S = %q(not a regex)')).toEqual([]);
	});

	it('reads a bare percent after a value as modulo', () => {
		expect(patterns('rest = total % count')).toEqual([]);
	});

	it('does not read the body of another percent literal as code', () => {
		// Failing to recognise `%q(…)` leaves its slashes to be read as a regex,
		// which is the whole reason the typed forms are recognised anywhere.
		expect(patterns('puts %q(/a/)')).toEqual([]);
		expect(patterns('puts %w[/a/ /b/]')).toEqual([]);
	});
});

describe('parseRubyRegexLiterals: interpolation', () => {
	it('skips a literal with interpolation, which has no pattern until it runs', () => {
		expect(patterns('RE = /#{prefix}\\d+/')).toEqual([]);
		expect(patterns('RE = %r{#{host}/path}')).toEqual([]);
	});

	it('keeps an escaped interpolation, which is literal text', () => {
		expect(patterns('RE = /\\#{not_interpolated}/')).toEqual(['\\#{not_interpolated}']);
	});

	it('keeps scanning correctly after a skipped literal', () => {
		const text = ['A = /#{x}/', 'B = /[a-z]+/'].join('\n');
		expect(patterns(text)).toEqual(['[a-z]+']);
	});
});

describe('parseRubyRegexLiterals: strings, comments and heredocs', () => {
	it('ignores slashes inside strings', () => {
		expect(patterns('url = "https://example.com/a/b"')).toEqual([]);
		expect(patterns("path = 'a/b/c'")).toEqual([]);
	});

	it('steps over interpolation that contains quotes of its own', () => {
		const text = ['s = "a#{h["k"]}b"', 'SLUG = /[a-z]+/'].join('\n');
		expect(patterns(text)).toEqual(['[a-z]+']);
	});

	it('ignores comments', () => {
		expect(patterns('# matches /nope/ when …')).toEqual([]);
		expect(patterns('x = 1 # ratio a/b/c')).toEqual([]);
	});

	it('ignores =begin blocks', () => {
		const text = ['=begin', 'see /nope/ for details', '=end', 'SLUG = /[a-z]+/'].join('\n');
		expect(patterns(text)).toEqual(['[a-z]+']);
	});

	it('skips a heredoc body, which is prose rather than code', () => {
		// Without this the slashes in the SQL would be read as a literal.
		const text = ['sql = <<~SQL', '  SELECT a/b, c/d FROM t', 'SQL', 'SLUG = /[a-z]+/'].join('\n');
		expect(patterns(text)).toEqual(['[a-z]+']);
	});

	it('does not mistake the append operator for a heredoc', () => {
		expect(patterns('list << item')).toEqual([]);
	});
});

describe('parseRubyRegexLiterals: Regexp.new', () => {
	it('finds the pattern and decodes the string', () => {
		expect(patterns('DYNAMIC = Regexp.new("^\\\\d+$")')).toEqual(['^\\d+$']);
		// Single quotes escape only the quote and the backslash, so a regex escape
		// survives either way.
		expect(patterns("DYNAMIC = Regexp.new('\\\\s+')")).toEqual(['\\s+']);
	});

	it('reads the option constants as flags', () => {
		expect(spans('R = Regexp.new("^a$", Regexp::IGNORECASE)')[0].flags).toBe('i');
		// Ruby's MULTILINE is "dot matches newline", the same rename its /m carries.
		expect(spans('R = Regexp.new("a", Regexp::MULTILINE)')[0].flags).toBe('s');
		expect(spans('R = Regexp.new("a b", Regexp::EXTENDED)')[0].droppedOptions).toEqual(['x']);
	});

	it('skips an interpolated argument, which has no pattern until it runs', () => {
		expect(patterns('R = Regexp.new("^#{prefix}")')).toEqual([]);
	});

	it('ignores strings in any other call', () => {
		expect(patterns('puts("^not a pattern$")')).toEqual([]);
		expect(patterns('Thing.new("^not a pattern$")')).toEqual([]);
	});

	it('ignores an argument after the first', () => {
		expect(patterns('R = Regexp.new("^a$", "^b$")')).toEqual(['^a$']);
	});

	it('is not fooled by a call inside a comment, heredoc or percent literal', () => {
		// The reason this lives in Ruby's own scanner rather than the shared one:
		// that scanner knows none of these.
		expect(patterns('# R = Regexp.new("^a$")')).toEqual([]);
		expect(patterns(['=begin', 'R = Regexp.new("^a$")', '=end'].join('\n'))).toEqual([]);
		expect(patterns(['sql = <<~SQL', '  Regexp.new("^a$")', 'SQL'].join('\n'))).toEqual([]);
		expect(patterns('puts %q(Regexp.new("^a$"))')).toEqual([]);
	});
});

describe('Ruby through the dispatcher', () => {
	it('finds literals and Regexp.new together, without duplicating either', () => {
		const text = ['SLUG = /[a-z]+/', 'DYNAMIC = Regexp.new("^\\\\d+$")'].join('\n');
		const found = [...parseRegexLiterals(text, 'app/models/thing.rb').values()].flat();
		expect(found.map((s) => s.pattern).sort()).toEqual(['[a-z]+', '^\\d+$']);
	});

	it('rewrites Ruby’s idiomatic anchors into ones this engine shares', () => {
		// `\A` and `\z` anchor nearly every Ruby validation, and RegExp reads them
		// as literal letters. On a single-line subject they are exactly `^` and `$`.
		const [span] = [...parseRegexLiterals('SLUG = /\\A[a-z]+\\z/', 'a.rb').values()].flat();
		expect(span.pattern).toBe('^[a-z]+$');
		expect(new RegExp(span.pattern, span.flags).test('abc')).toBe(true);
		expect(new RegExp(span.pattern, span.flags).test('ab c')).toBe(false);
	});

	it('carries the ruby dialect', () => {
		const [span] = [...parseRegexLiterals('SLUG = /a/', 'a.rb').values()].flat();
		expect(span.dialect).toBe('ruby');
	});
});
