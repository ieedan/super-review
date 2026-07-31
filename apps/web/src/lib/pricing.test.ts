import { describe, it, expect } from 'vitest';
import { isLaunchOpen, launchLastDay, formatPrice } from './pricing';

const CUTOFF = '2026-09-01T00:00:00Z';
const CUTOFF_MS = Date.parse(CUTOFF);

describe('isLaunchOpen', () => {
	it('is open right up to the cutoff and shut at it', () => {
		expect(isLaunchOpen(CUTOFF, CUTOFF_MS - 1)).toBe(true);
		expect(isLaunchOpen(CUTOFF, CUTOFF_MS)).toBe(false);
		expect(isLaunchOpen(CUTOFF, CUTOFF_MS + 1)).toBe(false);
	});

	it('fails closed on a missing or unparseable cutoff', () => {
		// A missing env var must never discount every sale.
		expect(isLaunchOpen(undefined, CUTOFF_MS - 1)).toBe(false);
		expect(isLaunchOpen('', CUTOFF_MS - 1)).toBe(false);
		expect(isLaunchOpen('not a date', CUTOFF_MS - 1)).toBe(false);
	});
});

describe('launchLastDay', () => {
	it('steps back from the exclusive cutoff, so it lands on August 31', () => {
		expect(launchLastDay(CUTOFF)?.toISOString()).toBe('2026-08-31T23:59:59.999Z');
	});

	it('is null when there is no usable cutoff', () => {
		expect(launchLastDay(undefined)).toBeNull();
		expect(launchLastDay('not a date')).toBeNull();
	});

	it('never claims a day the checkout would already have closed', () => {
		// The guarantee the derivation exists for: the advertised last day is
		// always still inside the open window.
		const lastDay = launchLastDay(CUTOFF)!;
		expect(isLaunchOpen(CUTOFF, lastDay.getTime())).toBe(true);
	});
});

describe('formatPrice', () => {
	it('always shows cents', () => {
		expect(formatPrice(59.99)).toBe('$59.99');
		expect(formatPrice(39.99)).toBe('$39.99');
		expect(formatPrice(60)).toBe('$60.00');
	});
});
