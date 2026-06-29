import { describe, expect, it } from 'vitest';
import { searchSettings } from './settings-search';

describe('searchSettings', () => {
	it('returns nothing for an empty query', () => {
		expect(searchSettings('')).toEqual([]);
		expect(searchSettings('   ')).toEqual([]);
	});

	it('matches by title substring', () => {
		const results = searchSettings('theme');
		expect(results.some((r) => r.id === 'theme')).toBe(true);
		expect(results.some((r) => r.id === 'diff-theme')).toBe(true);
	});

	it('matches by keyword alias', () => {
		const results = searchSettings('verified');
		expect(results.some((r) => r.id === 'commits')).toBe(true);
	});

	it('requires every query word to match', () => {
		const results = searchSettings('diff layout');
		expect(results.some((r) => r.id === 'diff-layout')).toBe(true);
		expect(results.some((r) => r.id === 'diff-view')).toBe(false);
	});

	it('finds individual hotkey entries', () => {
		const results = searchSettings('command palette');
		expect(results.some((r) => r.id === 'hotkey-searchFilesPalette')).toBe(true);
	});
});
