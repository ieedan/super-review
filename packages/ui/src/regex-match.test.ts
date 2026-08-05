import { describe, expect, it } from 'vitest';
import { compileRegex, describeMatch, evaluateRegex, segmentsFor } from './regex-match';

describe('compileRegex', () => {
	it('compiles a valid literal', () => {
		const result = compileRegex('a+b', 'gi');
		expect('regex' in result && result.regex.source).toBe('a+b');
		expect('regex' in result && result.regex.flags).toBe('gi');
	});

	it('reports the engine error for a bad pattern', () => {
		const result = compileRegex('a(', '');
		expect('error' in result && result.error.length > 0).toBe(true);
	});

	it('reports the engine error for a rejected flag combination', () => {
		// `u` and `v` are mutually exclusive.
		expect('error' in compileRegex('a', 'uv')).toBe(true);
	});

	it('hands back a fresh regex each time, so lastIndex never leaks', () => {
		const first = compileRegex('a', 'g');
		if (!('regex' in first)) throw new Error('expected a regex');
		first.regex.exec('aaa');
		expect(first.regex.lastIndex).toBe(1);
		const second = compileRegex('a', 'g');
		expect('regex' in second && second.regex.lastIndex).toBe(0);
	});
});

describe('evaluateRegex', () => {
	it('reports an invalid pattern rather than a failed match', () => {
		const result = evaluateRegex('a(', '', 'abc');
		expect(result.status).toBe('invalid');
	});

	it('reports invalid even before anything is typed', () => {
		// The literal is broken regardless of the test string, and saying so
		// immediately is more useful than an idle state.
		expect(evaluateRegex('[', '', '').status).toBe('invalid');
	});

	it('is idle for an empty test string', () => {
		expect(evaluateRegex('a', '', '').status).toBe('idle');
	});

	it('reports no match', () => {
		expect(evaluateRegex('z+', '', 'abc').status).toBe('no-match');
	});

	it('reports the single match of a non-global regex', () => {
		const result = evaluateRegex('b+', '', 'abbbc');
		expect(result).toEqual({ status: 'match', ranges: [{ start: 1, end: 4 }] });
	});

	it('reports only the first match without the global flag', () => {
		const result = evaluateRegex('a', '', 'aaa');
		expect(result).toEqual({ status: 'match', ranges: [{ start: 0, end: 1 }] });
	});

	it('reports every match with the global flag', () => {
		const result = evaluateRegex('a', 'g', 'banana');
		expect(result).toEqual({
			status: 'match',
			ranges: [
				{ start: 1, end: 2 },
				{ start: 3, end: 4 },
				{ start: 5, end: 6 }
			]
		});
	});

	it('honours the ignore-case flag', () => {
		expect(evaluateRegex('abc', 'i', 'xABCx')).toEqual({
			status: 'match',
			ranges: [{ start: 1, end: 4 }]
		});
	});

	it('anchors a sticky regex at the start', () => {
		expect(evaluateRegex('a', 'y', 'ba').status).toBe('no-match');
		expect(evaluateRegex('a', 'y', 'ab')).toEqual({
			status: 'match',
			ranges: [{ start: 0, end: 1 }]
		});
	});

	it('terminates on a global regex that matches the empty string', () => {
		// Without a manual lastIndex bump this loops forever.
		const result = evaluateRegex('a*', 'g', 'bab');
		expect(result.status).toBe('match');
		expect(result.status === 'match' && result.ranges.length).toBeLessThan(10);
	});

	it('caps the number of matches it collects', () => {
		const result = evaluateRegex('', 'g', 'x'.repeat(5000));
		expect(result.status === 'match' && result.ranges.length).toBeLessThanOrEqual(1000);
	});

	it('does not carry lastIndex between evaluations', () => {
		expect(evaluateRegex('a', 'g', 'aaa')).toEqual(evaluateRegex('a', 'g', 'aaa'));
	});
});

describe('segmentsFor', () => {
	it('splits the input into matched and unmatched runs', () => {
		expect(segmentsFor('abbbc', [{ start: 1, end: 4 }])).toEqual([
			{ text: 'a', matched: false },
			{ text: 'bbb', matched: true },
			{ text: 'c', matched: false }
		]);
	});

	it('handles a match at the start and at the end', () => {
		expect(segmentsFor('abc', [{ start: 0, end: 1 }])).toEqual([
			{ text: 'a', matched: true },
			{ text: 'bc', matched: false }
		]);
		expect(segmentsFor('abc', [{ start: 2, end: 3 }])).toEqual([
			{ text: 'ab', matched: false },
			{ text: 'c', matched: true }
		]);
	});

	it('handles several matches', () => {
		expect(
			segmentsFor('banana', [
				{ start: 1, end: 2 },
				{ start: 3, end: 4 }
			])
		).toEqual([
			{ text: 'b', matched: false },
			{ text: 'a', matched: true },
			{ text: 'n', matched: false },
			{ text: 'a', matched: true },
			{ text: 'na', matched: false }
		]);
	});

	it('covers the whole input when the match does', () => {
		expect(segmentsFor('abc', [{ start: 0, end: 3 }])).toEqual([{ text: 'abc', matched: true }]);
	});

	it('emits nothing highlighted for a zero-length match', () => {
		// There's no substring to paint, but the surrounding text must survive.
		expect(segmentsFor('abc', [{ start: 1, end: 1 }])).toEqual([{ text: 'abc', matched: false }]);
	});

	it('returns the input untouched with no ranges', () => {
		expect(segmentsFor('abc', [])).toEqual([{ text: 'abc', matched: false }]);
	});

	it('returns nothing for an empty input', () => {
		expect(segmentsFor('', [])).toEqual([]);
	});

	it('reassembles the original input', () => {
		const input = 'the quick brown fox';
		const result = evaluateRegex('o', 'g', input);
		const segments = segmentsFor(input, result.status === 'match' ? result.ranges : []);
		expect(segments.map((s) => s.text).join('')).toBe(input);
	});
});

describe('describeMatch', () => {
	it('describes a single match by its character range', () => {
		expect(describeMatch([{ start: 4, end: 9 }])).toBe('Match at characters 4-9');
	});

	it('describes a zero-length match by its position', () => {
		expect(describeMatch([{ start: 2, end: 2 }])).toBe('Empty match at character 2');
	});

	it('counts multiple matches', () => {
		expect(
			describeMatch([
				{ start: 0, end: 1 },
				{ start: 2, end: 3 }
			])
		).toBe('2 matches');
	});

	it('falls back to no match for an empty list', () => {
		expect(describeMatch([])).toBe('No match');
	});
});
