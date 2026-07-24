import type { Cents } from './types.js';
import { sum } from './money.js';

// Largest-remainder apportionment for money.
//
// When you divide a total by weight, each part rounds on its own and the parts
// no longer add up to the whole. This hands the leftover cents to the parts
// with the largest fractional remainder, so the result always sums back to the
// total. It is the same rule used to allocate legislative seats, which is the
// same problem wearing a different hat.
//
// Not wired into split.ts yet. Pulled out here so both the shares and percent
// strategies can share one correct implementation.
export function largestRemainder(total: Cents, weights: number[]): Cents[] {
	const totalWeight = sum(weights);
	if (totalWeight === 0) return weights.map(() => 0);

	const exact = weights.map((w) => (total * w) / totalWeight);
	const floors = exact.map((x) => Math.floor(x));
	let remainder = total - sum(floors);

	// Distribute the leftover cents, biggest fractional part first.
	const order = exact
		.map((x, i) => ({ i, frac: x - Math.floor(x) }))
		.sort((a, b) => b.frac - a.frac);

	const result = [...floors];
	for (const { i } of order) {
		if (remainder <= 0) break;
		result[i] += 1;
		remainder -= 1;
	}

	return result;
}
