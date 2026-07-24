import { describe, expect, it } from 'vitest';
import { formatAmount, formatMagnitude, sum } from '../src/lib/money.js';

describe('sum', () => {
	it('adds cents', () => {
		expect(sum([100, 250, 5])).toBe(355);
	});

	it('is zero for an empty ledger', () => {
		expect(sum([])).toBe(0);
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
