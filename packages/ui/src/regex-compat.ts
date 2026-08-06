// Owning up to the gap between the engine a pattern was written for and the one
// evaluating it.
//
// Every pattern here runs on the browser's `RegExp`, which is the real engine
// for a JavaScript literal and an approximation for everything else. The
// approximation is close: the overwhelming majority of patterns mean the same
// thing in both. Where they differ, it's usually loud, because `RegExp` throws
// and the popup shows the error. The dangerous case is the quiet one:
//
//   \Astart\z  tested against  start  ->  No match
//
// because `RegExp` reads `\A` as a literal "A". Without a word of explanation
// that reads as "your pattern is broken", which is the opposite of true.
//
// So this is deliberately one short sentence, only when there is a real
// difference. A standing "results may vary" on every non-JavaScript regex would
// be noise that trains people to ignore the one case that matters.
//
// Note that none of this branches on the source language. What matters is what
// `RegExp` does with the pattern in front of it: if it contains `(?P<name>`,
// then whichever language it came from, the answer here will be wrong.

// Escapes `RegExp` doesn't define, and so reads as the literal letter. The
// silent ones, and the reason this file exists.
const FOREIGN_ESCAPES = 'AZzGKRhH';

const NOTES = {
	escape: 'Uses escapes like \\A or \\z that the browser engine here reads as literal characters.',
	unicodeCategory:
		'Uses \\p{…} categories, which need a flag the browser engine only takes on its own patterns.',
	inlineOptions: 'Uses inline options like (?i), which the browser engine here has no syntax for.',
	pythonGroup:
		'Uses (?P<…>) named groups; the browser engine here spells them (?<…>) and rejects these.',
	comment: 'Uses (?#…) comments, which the browser engine here has no syntax for.',
	conditional: 'Uses conditionals like (?(1)…), which the browser engine here cannot express.',
	balancingGroup:
		'Uses balancing groups like (?<a-b>…), which the browser engine here cannot express.',
	classSubtraction:
		'Uses character-class subtraction or intersection, which the browser engine here cannot express.',
	possessive:
		'Uses possessive quantifiers like a++, which the browser engine here reads as a syntax error.'
} as const;

const OPTION_NOTES: Record<string, string> = {
	// Named flag constants, per language, that change the answer with no
	// `RegExp` equivalent.
	IgnorePatternWhitespace:
		'Whitespace-insensitive mode has no equivalent here, so spaces in the pattern count.',
	X: 'Whitespace-insensitive mode has no equivalent here, so spaces in the pattern count.',
	VERBOSE: 'Whitespace-insensitive mode has no equivalent here, so spaces in the pattern count.',
	COMMENTS: 'Whitespace-insensitive mode has no equivalent here, so spaces in the pattern count.',
	x: 'Whitespace-insensitive mode has no equivalent here, so spaces in the pattern count.',
	RightToLeft: 'Right-to-left matching has no equivalent here, so this searches left to right.',
	U: 'Ungreedy mode has no equivalent here, so quantifiers are greedy by default.',
	A: 'Anchored mode has no equivalent here, so this can match anywhere in the string.',
	LITERAL: 'Literal mode has no equivalent here, so the pattern is read as a regex.',
	L: 'Locale-dependent matching has no equivalent here.',
	LOCALE: 'Locale-dependent matching has no equivalent here.',
	ASCII: 'ASCII-only matching has no equivalent here, so \\w and \\d may match more.',
	UNIX_LINES: 'Unix-lines mode has no equivalent here, so \\r counts as a line break too.'
};

// The first construct in `pattern` that `RegExp` can't take, or null. Walks the
// pattern rather than testing it with regexes of our own, so an escaped `\\A` (a
// literal backslash and an A, which every engine agrees on) isn't mistaken for
// the `\A` anchor.
function foreignConstruct(pattern: string): keyof typeof NOTES | null {
	let inClass = false;
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];

		if (ch === '\\') {
			const next = pattern[i + 1] ?? '';
			if (FOREIGN_ESCAPES.includes(next)) return 'escape';
			if (next === 'p' || next === 'P') return 'unicodeCategory';
			i++;
			continue;
		}

		if (inClass) {
			// `[a-z-[aeiou]]` subtracts (.NET); `[a-z&&[^aeiou]]` intersects (Java).
			if (ch === '-' && pattern[i + 1] === '[') return 'classSubtraction';
			if (ch === '&' && pattern[i + 1] === '&') return 'classSubtraction';
			if (ch === ']') inClass = false;
			continue;
		}

		if (ch === '[') {
			inClass = true;
			continue;
		}

		// A quantifier followed by `+` is possessive, not a repeat of a repeat.
		if ('*+?}'.includes(ch) && pattern[i + 1] === '+') return 'possessive';

		if (ch === '(' && pattern[i + 1] === '?') {
			const rest = pattern.slice(i + 2);
			if (rest.startsWith('#')) return 'comment';
			if (rest.startsWith('(')) return 'conditional';
			if (rest.startsWith('P')) return 'pythonGroup';
			// `(?<name-other>…)` balances; `(?<name>…)` is an ordinary named group
			// that `RegExp` has too.
			if (/^<[A-Za-z_]\w*-/.test(rest)) return 'balancingGroup';
			// `(?i)`, `(?im-sx:…)`, distinguished from `(?:…)` by the option letters.
			if (/^[imnsx]+-?[imnsx]*[):]/.test(rest)) return 'inlineOptions';
		}
	}
	return null;
}

// Lift a leading `(?i)`-style group into real `RegExp` flags. This is how RE2
// languages (Go, Rust) spell flags at all, so without it their patterns would
// almost always fail to compile here for no good reason. Only at the very start,
// where the options unambiguously apply to the whole pattern.
export function normalizeInlineFlags(
	pattern: string,
	flags: string
): { pattern: string; flags: string } {
	const match = /^\(\?([ims]+)\)/.exec(pattern);
	if (!match) return { pattern, flags };
	let next = flags;
	for (const flag of match[1]) if (!next.includes(flag)) next += flag;
	return { pattern: pattern.slice(match[0].length), flags: next };
}

// One sentence naming a real difference between the pattern's home engine and
// this one, or null when there is none.
export function compatibilityNote(pattern: string, droppedOptions?: string[]): string | null {
	const construct = foreignConstruct(pattern);
	if (construct) return NOTES[construct];
	for (const option of droppedOptions ?? []) {
		const note = OPTION_NOTES[option];
		if (note) return note;
	}
	return null;
}
