import type { Cents, Split } from './types.js';
import { sum } from './money.js';

// How an expense total is divided among members.
//
// Every function in here returns a Split whose shares sum back to the total it
// was handed. That is the whole contract. A division that loses a cent shows up
// later as a balance sheet that does not sum to zero, and there is no way to
// tell afterwards which expense dropped it.

// Divide a total evenly, handing the leftover cents out one at a time.
//
// 10.00 across three people is 333, 333, 334 rather than three 333s and a
// vanished cent. The extra cents go to the members earliest in the list, which
// is arbitrary but stable: the same expense always splits the same way.
export function equalSplit(total: Cents, memberIds: string[]): Split {
	const shares: Record<string, Cents> = {};
	if (memberIds.length === 0) return { kind: 'equal', shares };

	const base = Math.floor(total / memberIds.length);
	let remainder = total - base * memberIds.length;

	for (const memberId of memberIds) {
		shares[memberId] = base + (remainder > 0 ? 1 : 0);
		if (remainder > 0) remainder -= 1;
	}

	return { kind: 'equal', shares };
}

// True when a split's shares add back up to the total it claims to divide.
// Cheap enough to call from tests and from the expense form before saving.
export function isBalanced(split: Split, total: Cents): boolean {
	return sum(Object.values(split.shares)) === total;
}
