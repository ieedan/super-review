import type { Cents } from './types.js';

// Cents in one major unit. Named rather than inlined so the multiply and the
// divide can never drift apart.
export const CENTS_PER_UNIT = 100;

// Add up cents. Trivial, but it keeps the reduce boilerplate out of callers and
// gives the balance invariant a single place to be spelled.
export function sum(values: Cents[]): Cents {
	let total = 0;
	for (const value of values) total += value;
	return total;
}

// Render cents for display. Intl handles the symbol placement and grouping
// separator so the group's currency does not have to be special-cased here.
export function formatAmount(cents: Cents, currency = 'USD'): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency
	}).format(cents / CENTS_PER_UNIT);
}

// Same as formatAmount but without a sign, for places that render the
// direction separately ("Alex owes Sam $12.50" rather than "-$12.50").
export function formatMagnitude(cents: Cents, currency = 'USD'): string {
	return formatAmount(Math.abs(cents), currency);
}
