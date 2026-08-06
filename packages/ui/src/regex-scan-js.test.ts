import { describe, expect, it } from 'vitest';
import { parseJsRegexLiterals } from './regex-scan-js';
import type { RegexLiteralSpan } from './regex-literals';

// Flatten the index to a plain list in line order, which is what most
// assertions here care about.
function literals(text: string): (RegexLiteralSpan & { line: number })[] {
	const out: (RegexLiteralSpan & { line: number })[] = [];
	for (const [line, spans] of parseJsRegexLiterals(text)) {
		for (const span of spans) out.push({ ...span, line });
	}
	return out.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
}

function sources(text: string): string[] {
	return literals(text).map((l) => l.source);
}

describe('parseJsRegexLiterals', () => {
	it('finds a literal and its character range', () => {
		const [literal] = literals('const re = /ab+c/gi;');
		expect(literal).toMatchObject({
			line: 1,
			pattern: 'ab+c',
			flags: 'gi',
			source: '/ab+c/gi'
		});
		// The span covers `/ab+c/gi` exactly.
		expect(literal.startCol).toBe(11);
		expect(literal.endCol).toBe(19);
		expect('const re = /ab+c/gi;'.slice(literal.startCol, literal.endCol)).toBe('/ab+c/gi');
	});

	it('records the line each literal is on', () => {
		const text = ['const a = /one/;', '', 'const b = /two/m;'].join('\n');
		expect(literals(text).map((l) => [l.line, l.source])).toEqual([
			[1, '/one/'],
			[3, '/two/m']
		]);
	});

	it('finds several literals on one line, in order', () => {
		expect(sources('line.split(/,/).map((s) => s.replace(/^\\s+/, ""))')).toEqual([
			'/,/',
			'/^\\s+/'
		]);
	});

	it('reads a literal with no flags', () => {
		const [literal] = literals('if (/^y(es)?$/.test(answer)) go();');
		expect(literal).toMatchObject({ pattern: '^y(es)?$', flags: '' });
	});

	it('stops flags at the first non-flag character', () => {
		const [literal] = literals('/a/g.test(s)');
		expect(literal).toMatchObject({ flags: 'g', source: '/a/g' });
		expect(literal.endCol).toBe(4);
	});

	it('keeps escapes intact in the pattern', () => {
		expect(sources('const p = /\\d+\\.\\d+/;')).toEqual(['/\\d+\\.\\d+/']);
	});

	it('treats an escaped slash as part of the pattern', () => {
		expect(sources('const p = /a\\/b/;')).toEqual(['/a\\/b/']);
	});

	it('does not end the literal on a slash inside a character class', () => {
		expect(sources('const p = /[/*]+/g;')).toEqual(['/[/*]+/g']);
	});
});

describe('parseJsRegexLiterals: division vs regex', () => {
	it('reads a slash after an identifier as division', () => {
		expect(sources('const ratio = width / height;')).toEqual([]);
	});

	it('reads a slash after a number, `)` or `]` as division', () => {
		expect(sources('const a = 10 / 2;')).toEqual([]);
		expect(sources('const a = (b + c) / 2;')).toEqual([]);
		expect(sources('const a = xs[0] / 2;')).toEqual([]);
	});

	it('does not read two divisions on one line as a literal', () => {
		expect(sources('const avg = total / count / 2;')).toEqual([]);
	});

	it('reads a slash after a regex-permitting keyword as a literal', () => {
		expect(sources('return /ok/.test(s);')).toEqual(['/ok/']);
		expect(sources('if (typeof /x/ === "object") {}')).toEqual(['/x/']);
		expect(sources('const found = items.find((i) => /a/.test(i));')).toEqual(['/a/']);
	});

	it('reads a slash after an operator or opening bracket as a literal', () => {
		expect(sources('const p = /a/;')).toEqual(['/a/']);
		expect(sources('call(/a/, x);')).toEqual(['/a/']);
		expect(sources('const list = [/a/, /b/];')).toEqual(['/a/', '/b/']);
		expect(sources('x = cond ? /yes/ : /no/;')).toEqual(['/yes/', '/no/']);
	});

	it('divides after a regex literal rather than starting another', () => {
		// `/a/ / 2`: the second slash divides the literal, the third is not a
		// literal opener either.
		expect(sources('const n = /a/ / 2;')).toEqual(['/a/']);
	});

	it('reads a slash after a control-flow head as a literal', () => {
		// `)` usually ends an expression, but the one closing an `if`/`while` head
		// is followed by a statement, where a regex can start.
		expect(sources('if (ok) /^a/.test(s);')).toEqual(['/^a/']);
		expect(sources('while (n) /^a/.test(s);')).toEqual(['/^a/']);
		expect(sources('for (;;) /^a/.test(s);')).toEqual(['/^a/']);
		// An ordinary parenthesised expression still divides.
		expect(sources('const r = (a + b) / 2;')).toEqual([]);
	});

	it('reads a slash after a postfix increment as division', () => {
		// Read as two `+` tokens this looks like an operator, and the `/` after it
		// like a regex opener that swallows the rest of the line.
		expect(sources('const r = i++ / 2 + j / 3;')).toEqual([]);
		expect(sources('const r = n-- / 2;')).toEqual([]);
		// A prefix increment leaves an operator, so division still reads as one.
		expect(sources('const r = ++i / 2;')).toEqual([]);
	});

	it('does not read a JSX closing tag as a literal', () => {
		// `</span>` puts a `/` exactly where a regex could start, and the next `/`
		// on the line closes it. The other reading, `a < /re/`, is a comparison
		// against a regex, which nobody writes.
		expect(sources('return <div><span>x</span></div>;')).toEqual([]);
		expect(sources('return <Foo a={1} />;')).toEqual([]);
		// A regex elsewhere on a JSX line is still found.
		expect(sources('return <Foo ok={/^a/.test(s)} />;')).toEqual(['/^a/']);
	});

	it('does not read a `/=` after a value as a literal', () => {
		expect(sources('total /= count;')).toEqual([]);
	});
});

describe('parseJsRegexLiterals: strings, comments and templates', () => {
	it('ignores slashes inside strings', () => {
		expect(sources('const url = "https://example.com/a/b";')).toEqual([]);
		expect(sources("const p = 'a/b/c';")).toEqual([]);
	});

	it('ignores line comments', () => {
		expect(sources('// see /not-a-regex/ for details')).toEqual([]);
		expect(sources('const a = 1; // ratio a/b/c')).toEqual([]);
	});

	it('ignores block comments, including multi-line ones', () => {
		const text = ['/*', ' * matches /nope/g when …', ' */', 'const p = /yes/;'].join('\n');
		expect(literals(text).map((l) => [l.line, l.source])).toEqual([[4, '/yes/']]);
	});

	it('keeps counting lines and columns across a block comment', () => {
		const text = ['/* one\ntwo */ const p = /x/;'].join('');
		const [literal] = literals(text);
		expect(literal.line).toBe(2);
		expect(text.split('\n')[1].slice(literal.startCol, literal.endCol)).toBe('/x/');
	});

	it('ignores slashes in template literal text but reads them in interpolations', () => {
		expect(sources('const s = `a/b/c`;')).toEqual([]);
		expect(sources('const s = `x${line.replace(/a/g, "")}y`;')).toEqual(['/a/g']);
	});

	it('handles a nested template inside an interpolation', () => {
		expect(sources('const s = `${`${v.split(/,/)}`}`;')).toEqual(['/,/']);
	});

	it('does not mistake an object literal inside an interpolation for a template end', () => {
		expect(sources('const s = `${fn({ a: 1 })} ${p.match(/b/)}`;')).toEqual(['/b/']);
	});

	it('resumes normal scanning after a template', () => {
		expect(sources('const s = `a`; const p = /after/;')).toEqual(['/after/']);
	});
});

describe('parseJsRegexLiterals: degrading gracefully', () => {
	it('ignores an unterminated literal', () => {
		expect(sources('const p = /unterminated\nconst q = 1;')).toEqual([]);
	});

	it('ignores a literal whose escape runs into the newline', () => {
		expect(sources('const p = /bad\\\nnext')).toEqual([]);
	});

	it('recovers on the next line after an unterminated string', () => {
		const text = ['const s = "oops', 'const p = /good/;'].join('\n');
		expect(literals(text).map((l) => [l.line, l.source])).toEqual([[2, '/good/']]);
	});

	it('returns nothing for text with no literals', () => {
		expect(parseJsRegexLiterals('export const x = 1;\n').size).toBe(0);
	});

	it('handles an empty file', () => {
		expect(parseJsRegexLiterals('').size).toBe(0);
	});
});
