import { describe, expect, it } from 'vitest';
import { captureAnchor, resolveAnchor, splitLines } from './comment-anchor';

const FILE = [
	'import { a } from "./a";',
	'',
	'export function add(x: number, y: number): number {',
	'\tconst sum = x + y;',
	'\treturn sum;',
	'}',
	'',
	'export function sub(x: number, y: number): number {',
	'\tconst diff = x - y;',
	'\treturn diff;',
	'}',
	''
].join('\n');

const lines = (s: string) => splitLines(s);

function anchorAt(contents: string, line: number, end = line) {
	const a = captureAnchor(contents, line, end);
	if (!a) throw new Error('no anchor');
	return { anchor: a, stored: { startLine: line, endLine: end } };
}

describe('splitLines', () => {
	it('treats a trailing newline as a terminator and strips CR', () => {
		expect(splitLines('a\r\nb\n')).toEqual(['a', 'b']);
		expect(splitLines('')).toEqual([]);
	});
});

describe('captureAnchor', () => {
	it('captures the block and surrounding context', () => {
		const a = captureAnchor(FILE, 5, 5)!;
		expect(a.lines).toEqual(['\treturn sum;']);
		expect(a.before).toEqual([
			'',
			'export function add(x: number, y: number): number {',
			'\tconst sum = x + y;'
		]);
		expect(a.after).toEqual(['}', '', 'export function sub(x: number, y: number): number {']);
	});

	it('returns null for a range outside the file', () => {
		expect(captureAnchor(FILE, 0, 1)).toBeNull();
		expect(captureAnchor(FILE, 50, 50)).toBeNull();
	});
});

describe('resolveAnchor', () => {
	it('stays put when nothing changed', () => {
		const { anchor, stored } = anchorAt(FILE, 9);
		expect(resolveAnchor(anchor, stored, FILE)).toEqual({
			status: 'exact',
			startLine: 9,
			endLine: 9
		});
	});

	it('follows the code when lines are added above', () => {
		const { anchor, stored } = anchorAt(FILE, 9);
		const edited = ['// one', '// two', '// three', FILE].join('\n');
		expect(resolveAnchor(anchor, stored, edited)).toEqual({
			status: 'moved',
			startLine: 12,
			endLine: 12
		});
	});

	it('follows the code when lines are removed above', () => {
		const { anchor, stored } = anchorAt(FILE, 9);
		const edited = lines(FILE).slice(2).join('\n');
		expect(resolveAnchor(anchor, stored, edited)).toMatchObject({ status: 'moved', startLine: 7 });
	});

	it('picks the right copy of a repeated line using its context', () => {
		// "}" appears twice; the comment is on the second one.
		const { anchor, stored } = anchorAt(FILE, 11);
		const edited = ['// header', '// header2', FILE].join('\n');
		expect(resolveAnchor(anchor, stored, edited)).toMatchObject({ status: 'moved', startLine: 13 });
	});

	it('does not stay on a different identical line at the old position', () => {
		// Insert enough above that the old line number now holds another "}".
		const { anchor, stored } = anchorAt(FILE, 6); // first "}"
		const edited = ['// x', '// y', '// z', '// w', '// v', FILE].join('\n');
		expect(resolveAnchor(anchor, stored, edited)).toMatchObject({ status: 'moved', startLine: 11 });
	});

	it('survives a small edit to the commented line', () => {
		const { anchor, stored } = anchorAt(FILE, 4); // const sum = x + y;
		const edited = FILE.replace('const sum = x + y;', 'const total = x + y;');
		expect(resolveAnchor(anchor, stored, edited)).toMatchObject({ status: 'fuzzy', startLine: 4 });
	});

	it('follows a moved block even when its neighbours changed', () => {
		const { anchor, stored } = anchorAt(FILE, 4);
		const edited = [
			'function other() {}',
			'',
			'const unrelated = 1;',
			'const unrelated2 = 2;',
			'\tconst sum = x + y;'
		].join('\n');
		expect(resolveAnchor(anchor, stored, edited)).toMatchObject({ status: 'moved', startLine: 5 });
	});

	it('is outdated when the code is gone', () => {
		const { anchor, stored } = anchorAt(FILE, 9);
		const edited = 'completely different\nfile contents here\n';
		expect(resolveAnchor(anchor, stored, edited)).toEqual({ status: 'outdated' });
	});

	it('is outdated when the file is emptied', () => {
		const { anchor, stored } = anchorAt(FILE, 9);
		expect(resolveAnchor(anchor, stored, '')).toEqual({ status: 'outdated' });
	});

	it('keeps a multi-line range together', () => {
		const { anchor, stored } = anchorAt(FILE, 9, 10);
		const edited = ['// a', '// b', FILE].join('\n');
		expect(resolveAnchor(anchor, stored, edited)).toEqual({
			status: 'moved',
			startLine: 11,
			endLine: 12
		});
	});

	it('does not relocate onto trivial lines with a changed context', () => {
		// A lone "}" with all its neighbours rewritten is too ambiguous to follow.
		const { anchor, stored } = anchorAt(FILE, 6);
		const edited = 'x\n}\ny\nz\n}\nw\n';
		expect(resolveAnchor(anchor, stored, edited).status).toBe('outdated');
	});

	it('is fast on a large file', () => {
		const big = Array.from({ length: 20000 }, (_, i) => `const v${i} = compute(${i});`).join('\n');
		const { anchor, stored } = anchorAt(big, 15001);
		const edited = `// new\n${big.replace('const v15000 = compute(15000);', 'const v15000 = compute(15001);')}`;
		const t = performance.now();
		const r = resolveAnchor(anchor, stored, edited);
		expect(performance.now() - t).toBeLessThan(1500);
		expect(r).toMatchObject({ status: 'fuzzy', startLine: 15002 });
	});
});
