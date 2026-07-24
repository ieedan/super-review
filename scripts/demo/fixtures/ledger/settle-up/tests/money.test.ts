import { describe, expect, it } from 'vitest';
import { formatAmount, formatMagnitude, parseAmount, sum } from '../src/lib/money.js';

describe('sum', () => {
	it('adds cents', () => {
		expect(sum([100, 250, 5])).toBe(355);
	});

	it('is zero for an empty ledger', () => {
		expect(sum([])).toBe(0);
	});
});

describe('parseAmount', () => {
	it('reads a plain number', () => {
		expect(parseAmount('12')).toBe(1200);
	});

	it('reads a decimal', () => {
		expect(parseAmount('12.50')).toBe(1250);
	});

	it('ignores a currency symbol and separators', () => {
		expect(parseAmount('$1,200.00')).toBe(120000);
	});

	it('is null for junk', () => {
		expect(parseAmount('abc')).toBeNull();
	});

	it('is null for an empty field', () => {
		expect(parseAmount('')).toBeNull();
	});
});

describe('formatAmount', () => {
	it('renders cents as a currency string', () => {
		expect(formatAmount(1250, 'USD')).toBe('$12.50');
	});

	it('keeps the sign for a negative balance', () => {
		expect(formatAmount(-1250, 'USD')).toBe('-$12.50');
	});
});

describe('formatMagnitude', () => {
	it('drops the sign so the direction can be rendered separately', () => {
		expect(formatMagnitude(-1250, 'USD')).toBe('$12.50');
	});
});
