import { describe, expect, it } from 'vitest';
import { compatibilityNote, normalizeInlineFlags } from './regex-compat';

describe('compatibilityNote', () => {
	it('says nothing about a pattern every engine agrees on', () => {
		// The common case by a wide margin, and a standing disclaimer here would
		// train people to ignore the notes that matter.
		expect(compatibilityNote('(?<!@)@([A-Za-z_][A-Za-z0-9_]*)')).toBeNull();
		expect(compatibilityNote('^\\d{3}-\\d{4}$')).toBeNull();
		expect(compatibilityNote('(?<year>\\d{4})')).toBeNull();
		expect(compatibilityNote('[a-z-]+')).toBeNull();
		expect(compatibilityNote('a{2,3}+b')).not.toBeNull(); // possessive, see below
	});

	it('flags foreign anchors, which RegExp silently reads as literals', () => {
		// The dangerous case: `\A` matches a literal "A" here, so without a note
		// the popup gives a confident wrong answer rather than an error.
		expect(compatibilityNote('\\Afoo\\z')).toContain('escapes');
		expect(compatibilityNote('\\Gfoo')).toContain('escapes');
		expect(compatibilityNote('foo\\Kbar')).toContain('escapes');
	});

	it('does not mistake an escaped backslash for an anchor', () => {
		// `\\A` is a literal backslash followed by A, which every engine agrees on.
		expect(compatibilityNote('\\\\Afoo')).toBeNull();
	});

	it('flags inline options', () => {
		expect(compatibilityNote('foo(?i)bar')).toContain('inline options');
		expect(compatibilityNote('(?im-sx:hello)')).toContain('inline options');
	});

	it('does not mistake an ordinary group for inline options', () => {
		expect(compatibilityNote('(?:hello)')).toBeNull();
		expect(compatibilityNote('(?=hello)')).toBeNull();
		expect(compatibilityNote('(?<!hello)')).toBeNull();
	});

	it('flags Python-style named groups, which RegExp spells differently', () => {
		expect(compatibilityNote('(?P<year>\\d{4})')).toContain('(?P<');
	});

	it('flags conditionals, comments and balancing groups', () => {
		expect(compatibilityNote('(?(1)yes|no)')).toContain('conditionals');
		expect(compatibilityNote('a(?#note)b')).toContain('comments');
		expect(compatibilityNote('(?<open>a)(?<close-open>b)')).toContain('balancing groups');
	});

	it('flags character-class subtraction and intersection', () => {
		expect(compatibilityNote('[a-z-[aeiou]]')).toContain('subtraction');
		expect(compatibilityNote('[a-z&&[^aeiou]]')).toContain('subtraction');
	});

	it('flags possessive quantifiers', () => {
		expect(compatibilityNote('a++b')).toContain('possessive');
		expect(compatibilityNote('a*+b')).toContain('possessive');
	});

	it('flags unicode categories, which need a flag the pattern cannot carry', () => {
		expect(compatibilityNote('\\p{Lu}+')).toContain('categories');
	});

	it('flags options that change matching with no equivalent', () => {
		expect(compatibilityNote('a b', ['IgnorePatternWhitespace'])).toContain('Whitespace');
		expect(compatibilityNote('a b', ['VERBOSE'])).toContain('Whitespace');
		expect(compatibilityNote('ab', ['RightToLeft'])).toContain('Right-to-left');
		expect(compatibilityNote('ab', ['U'])).toContain('Ungreedy');
	});

	it('ignores an option it has nothing to say about', () => {
		expect(compatibilityNote('ab', ['SomethingElse'])).toBeNull();
	});

	it('leads with the pattern construct when both apply', () => {
		// The construct usually stops the pattern compiling at all, so it explains
		// more of what the user is looking at than the option does.
		expect(compatibilityNote('foo(?i)bar', ['VERBOSE'])).toContain('inline options');
	});
});

describe('normalizeInlineFlags', () => {
	it('lifts a leading option group into real flags', () => {
		// Without this, nearly every Go and Rust pattern would fail to compile
		// here, since inline groups are how RE2 spells flags at all.
		expect(normalizeInlineFlags('(?i)^hello$', '')).toEqual({ pattern: '^hello$', flags: 'i' });
		expect(normalizeInlineFlags('(?is)a', '')).toEqual({ pattern: 'a', flags: 'is' });
	});

	it('merges with flags the call already supplied, without duplicating', () => {
		expect(normalizeInlineFlags('(?i)a', 'i')).toEqual({ pattern: 'a', flags: 'i' });
		expect(normalizeInlineFlags('(?i)a', 'm')).toEqual({ pattern: 'a', flags: 'mi' });
	});

	it('leaves a group that is not at the start, which does not apply globally', () => {
		expect(normalizeInlineFlags('foo(?i)bar', '')).toEqual({ pattern: 'foo(?i)bar', flags: '' });
	});

	it('leaves options with no RegExp equivalent for the note to explain', () => {
		expect(normalizeInlineFlags('(?x)a b', '')).toEqual({ pattern: '(?x)a b', flags: '' });
	});

	it('leaves an ordinary group alone', () => {
		expect(normalizeInlineFlags('(?:a)b', '')).toEqual({ pattern: '(?:a)b', flags: '' });
		expect(normalizeInlineFlags('(?<y>a)', '')).toEqual({ pattern: '(?<y>a)', flags: '' });
	});
});
