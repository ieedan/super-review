import { describe, expect, it } from 'vitest';
import {
	isRegexTestablePath,
	parseRegexLiterals,
	regexLanguageFor,
	regexSpanAt
} from './regex-literals';
import { parseJsRegexLiterals } from './regex-scan-js';

describe('regexLanguageFor', () => {
	it('resolves each supported extension to its language', () => {
		const cases: Record<string, string> = {
			'src/a.ts': 'javascript',
			'src/a.jsx': 'javascript',
			'src/A.cs': 'csharp',
			'src/a.py': 'python',
			'src/A.java': 'java',
			'src/A.kt': 'kotlin',
			'src/a.go': 'go',
			'src/a.rs': 'rust',
			'src/a.php': 'php'
		};
		for (const [path, language] of Object.entries(cases)) {
			expect(regexLanguageFor(path), path).toBe(language);
		}
	});

	it('is case insensitive and handles Windows separators', () => {
		expect(regexLanguageFor('src\\components\\A.TS')).toBe('javascript');
	});

	it('has no language for anything else', () => {
		// The template languages are deliberately out: the JavaScript scanner
		// assumes JavaScript token rules and would read `</div>` as a regex.
		for (const path of ['a.svelte', 'a.vue', 'a.html', 'a.json', 'README.md', 'Makefile']) {
			expect(regexLanguageFor(path), path).toBeNull();
		}
	});
});

describe('isRegexTestablePath', () => {
	it('is true for exactly the languages that resolve', () => {
		expect(isRegexTestablePath('src/a.py')).toBe(true);
		expect(isRegexTestablePath('src/a.svelte')).toBe(false);
	});
});

describe('parseRegexLiterals', () => {
	it('picks the scanner from the file path', () => {
		// The same text means different things in different languages, so the path
		// is what decides. Only Python finds a regex here.
		const text = 're.compile(r"^a$")';
		expect([...parseRegexLiterals(text, 'a.py').values()].flat().map((s) => s.pattern)).toEqual([
			'^a$'
		]);
		expect([...parseRegexLiterals(text, 'a.ts').values()]).toEqual([]);
	});

	it('finds JavaScript literals, which have no call to sit in', () => {
		expect([...parseRegexLiterals('const p = /^a$/i;', 'a.ts').values()].flat()).toMatchObject([
			{ pattern: '^a$', flags: 'i', dialect: 'javascript' }
		]);
	});

	it('returns nothing for a language it does not know', () => {
		expect(parseRegexLiterals('const p = /^a$/;', 'a.svelte').size).toBe(0);
	});
});

describe('regexSpanAt', () => {
	const index = parseJsRegexLiterals('const re = /ab+c/gi;');
	// `/ab+c/gi` occupies columns 11..19.

	it('resolves a token that covers the whole literal', () => {
		expect(regexSpanAt(index, 1, 11, 19)?.source).toBe('/ab+c/gi');
	});

	it('resolves any fragment of it', () => {
		// Highlighting and intra-line diffs split the literal into pieces; each
		// one must resolve to the same literal.
		expect(regexSpanAt(index, 1, 11, 12)?.source).toBe('/ab+c/gi'); // the opening slash
		expect(regexSpanAt(index, 1, 13, 15)?.source).toBe('/ab+c/gi'); // the middle
		expect(regexSpanAt(index, 1, 17, 19)?.source).toBe('/ab+c/gi'); // the flags
	});

	it('returns null for tokens outside the literal', () => {
		expect(regexSpanAt(index, 1, 0, 5)).toBeNull(); // `const`
		expect(regexSpanAt(index, 1, 19, 20)).toBeNull(); // the trailing `;`
	});

	it('ignores a token that merely contains the literal', () => {
		// Pierre's first, pre-highlight paint emits one token per line. Matching it
		// would make the whole line testable, so a token that is mostly outside the
		// literal is not a fragment of it.
		expect(regexSpanAt(index, 1, 0, 20)).toBeNull();
	});

	it('still resolves a token that runs slightly past the literal', () => {
		// Shiki gives up on an unparseable literal and lumps its tail in with what
		// follows; that token is still overwhelmingly the literal.
		const broken = parseJsRegexLiterals('const B = /(unclosed/;');
		expect(regexSpanAt(broken, 1, 12, 22)?.source).toBe('/(unclosed/');
	});

	it('returns null for a line with no literals', () => {
		expect(regexSpanAt(index, 2, 0, 5)).toBeNull();
	});

	it('picks the literal the token overlaps when a line has several', () => {
		const many = parseJsRegexLiterals('s.split(/,/).join(/;/);');
		expect(regexSpanAt(many, 1, 8, 11)?.source).toBe('/,/');
		expect(regexSpanAt(many, 1, 18, 21)?.source).toBe('/;/');
	});
});
