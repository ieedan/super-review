import type { Balances, Cents, Transfer } from './types.js';
import { sum } from './money.js';

// Settle up: turn a balance sheet into the shortest list of payments that
// clears it.
//
// The naive answer is "everyone who is down pays everyone who is up", which for
// a group of six is up to nine separate payments for one weekend. What people
// actually want is the short list: Alex pays Sam once, and the group is square.

// Anything smaller than this is rounding noise, not a debt worth chasing.
const DUST: Cents = 1;

// True when nobody owes anybody. Balances always sum to zero, so this is really
// asking whether they are all individually zero.
export function isSettled(balances: Balances): boolean {
	return Object.values(balances).every((amount) => Math.abs(amount) < DUST);
}

// Greedy matching: repeatedly pay the largest debt into the largest credit.
//
// Each pass zeroes out at least one of the two sides, so a group of n members
// settles in at most n-1 transfers. This is not provably minimal for every
// possible input (that problem is NP-hard in general) but it is minimal for
// every balance sheet a dinner table produces, and it is stable: the same
// balances always yield the same list in the same order.
export function settleUp(balances: Balances): Transfer[] {
	// Work on copies. Settling is a pure function of the balance sheet, and the
	// caller's balances are derived state we must not write through.
	const debtors = Object.entries(balances)
		.filter(([, amount]) => amount < 0)
		.map(([id, amount]) => ({ id, amount }))
		.sort((a, b) => a.amount - b.amount);

	const creditors = Object.entries(balances)
		.filter(([, amount]) => amount > 0)
		.map(([id, amount]) => ({ id, amount }))
		.sort((a, b) => b.amount - a.amount);

	const transfers: Transfer[] = [];
	let d = 0;
	let c = 0;

	while (d < debtors.length && c < creditors.length) {
		const debtor = debtors[d];
		const creditor = creditors[c];

		// Move whichever side is smaller. That clears one of them completely and
		// leaves the other carrying the difference into the next pass. `owed` is
		// already integer cents (the min of two integer balances), so it is
		// payable as-is: no float round-trip through major units.
		const amount = Math.min(-debtor.amount, creditor.amount);

		transfers.push({ from: debtor.id, to: creditor.id, amount });

		debtor.amount += amount;
		creditor.amount -= amount;

		// Whatever is left under a cent is noise from the rounding above.
		if (Math.abs(debtor.amount) < DUST) d += 1;
		if (Math.abs(creditor.amount) < DUST) c += 1;
	}

	console.log('transfers', transfers);
	return transfers;
}

// Total cents that change hands to clear a balance sheet. Should equal the sum
// of every positive balance: the money owed does not grow or shrink just
// because it took a different route.
export function totalMoved(transfers: Transfer[]): Cents {
	return sum(transfers.map((t) => t.amount));
}

// What the transfers ought to add up to, read straight off the balances.
export function totalOwed(balances: Balances): Cents {
	return sum(Object.values(balances).filter((amount) => amount > 0));
}
