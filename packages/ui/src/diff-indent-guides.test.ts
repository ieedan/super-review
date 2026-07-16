import { describe, expect, it } from 'vitest';
import { detectIndentStep, leadingWidth, resolveBlankWidths } from './diff-indent-guides';

describe('leadingWidth', () => {
	it('counts leading spaces', () => {
		expect(leadingWidth('foo')).toBe(0);
		expect(leadingWidth('  foo')).toBe(2);
		expect(leadingWidth('        foo')).toBe(8);
	});

	it('advances tabs to the next tab stop', () => {
		// tabSize 2: each tab from a stop is 2 columns.
		expect(leadingWidth('\tfoo', 2)).toBe(2);
		expect(leadingWidth('\t\tfoo', 2)).toBe(4);
		// A space then a tab lands on the next stop, not space + tabSize.
		expect(leadingWidth(' \tfoo', 2)).toBe(2);
		expect(leadingWidth(' \tfoo', 4)).toBe(4);
	});

	it('returns null for blank lines', () => {
		expect(leadingWidth('')).toBeNull();
		expect(leadingWidth('   ')).toBeNull();
		expect(leadingWidth('\t')).toBeNull();
		// Rendered lines keep their trailing newline; still blank.
		expect(leadingWidth('\n')).toBeNull();
		expect(leadingWidth('  \r\n')).toBeNull();
	});

	it('stops at the first non-whitespace character', () => {
		expect(leadingWidth('  // comment')).toBe(2);
	});
});

describe('detectIndentStep', () => {
	it('detects 4-space indentation', () => {
		const src = ['function f() {', '    if (x) {', '        y();', '    }', '}'].join('\n');
		expect(detectIndentStep(src)).toBe(4);
	});

	it('detects 2-space indentation', () => {
		const src = ['function f() {', '  if (x) {', '    y();', '  }', '}'].join('\n');
		expect(detectIndentStep(src)).toBe(2);
	});

	it('detects tab indentation at the rendered tab size', () => {
		const src = ['function f() {', '\tif (x) {', '\t\ty();', '\t}', '}'].join('\n');
		expect(detectIndentStep(src, 2)).toBe(2);
	});

	it('ignores blank lines between indent changes', () => {
		const src = ['function f() {', '', '    y();', '}'].join('\n');
		expect(detectIndentStep(src)).toBe(4);
	});

	it('ignores continuation-sized jumps in favor of the common unit', () => {
		const src = [
			'const x = call(',
			'\ta,',
			'\tb',
			');',
			'if (x) {',
			'\ty();',
			'}',
			'while (x) {',
			'\tz();',
			'}'
		].join('\n');
		expect(detectIndentStep(src, 2)).toBe(2);
	});

	it('falls back to 4 for flat files', () => {
		expect(detectIndentStep('a\nb\nc')).toBe(4);
	});
});

describe('resolveBlankWidths', () => {
	it('passes non-blank widths through', () => {
		expect(resolveBlankWidths([0, 4, 8])).toEqual([0, 4, 8]);
	});

	it('extends blanks with the min of their neighbors', () => {
		// Blank line inside a block keeps the block's guides...
		expect(resolveBlankWidths([4, null, 4])).toEqual([4, 4, 4]);
		// ...but a blank between a nested block and its close does not
		// overshoot past the shallower side.
		expect(resolveBlankWidths([8, null, 4])).toEqual([8, 4, 4]);
		// A blank between top-level blocks gets no guides.
		expect(resolveBlankWidths([0, null, 0])).toEqual([0, 0, 0]);
	});

	it('extends a run of blanks uniformly', () => {
		expect(resolveBlankWidths([4, null, null, null, 8])).toEqual([4, 4, 4, 4, 8]);
	});

	it('uses the only available neighbor at column edges', () => {
		expect(resolveBlankWidths([null, 4])).toEqual([4, 4]);
		expect(resolveBlankWidths([4, null])).toEqual([4, 4]);
		expect(resolveBlankWidths([null, null])).toEqual([0, 0]);
	});
});
