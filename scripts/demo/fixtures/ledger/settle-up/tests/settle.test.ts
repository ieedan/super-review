import { describe, expect, it } from 'vitest';
import type { Balances } from '../src/lib/types.js';
import { isSettled, settleUp, totalMoved, totalOwed } from '../src/lib/settle.js';

// A balance sheet always sums to zero. These fixtures are hand-built to say so.
const twoPeople: Balances = { alex: -1500, sam: 1500 };
const threePeople: Balances = { alex: -2000, blair: 500, sam: 1500 };

describe('settleUp', () => {
	it('clears a two-person debt with one payment', () => {
		expect(settleUp(twoPeople)).toEqual([{ from: 'alex', to: 'sam', amount: 1500 }]);
	});

	it('uses at most n-1 transfers', () => {
		expect(settleUp(threePeople).length).toBeLessThanOrEqual(2);
	});

	it('pays out exactly what is owed', () => {
		expect(totalMoved(settleUp(threePeople))).toBe(totalOwed(threePeople));
	});

	// The one that matters: three people, a total that does not divide evenly.
	// Every cent that was owed has to actually change hands.
	it('moves every owed cent when the split leaves a remainder', () => {
		const balances: Balances = { alex: -1000, blair: 333, sam: 667 };
		expect(totalMoved(settleUp(balances))).toBe(totalOwed(balances));
	});

	it('returns nothing for an already-square group', () => {
		expect(settleUp({ alex: 0, sam: 0 })).toEqual([]);
	});
});

describe('isSettled', () => {
	it('is true when everyone is at zero', () => {
		expect(isSettled({ alex: 0, sam: 0 })).toBe(true);
	});

	it('is false while anyone is owed', () => {
		expect(isSettled(twoPeople)).toBe(false);
	});
});
