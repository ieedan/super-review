// The data model. Read this first: every other module is a function over these
// shapes.

// Money is always an integer number of cents. Nothing here stores a float
// amount, because a float cannot represent 0.10 exactly and three of them do
// not sum to 0.30.
export type Cents = number;

export interface Member {
	id: string;
	name: string;
	// Shown in the avatar bubble when the member has no photo.
	initials: string;
	// A hex color, assigned once when the member joins so their avatar and
	// their row in the balance list agree.
	color: string;
}

export interface Group {
	id: string;
	name: string;
	members: Member[];
	// ISO-4217 code. Drives formatting, not conversion: a group is single
	// currency by design.
	currency: string;
}

// How an expense total is divided.
//
//  equal    every member pays the same, leftover cents handed out in order
//  exact    the payer types each member's share directly
//  shares   weights, for "she had two courses and I had one"
//  percent  weights that must add up to 100
export type SplitKind = 'equal' | 'exact' | 'shares' | 'percent';

export interface Split {
	kind: SplitKind;
	// Cents owed, keyed by member id. Invariant: the values sum to the
	// expense total. Every function that builds a Split is responsible for
	// upholding that, including the remainder cents.
	shares: Record<string, Cents>;
}

export interface Expense {
	id: string;
	groupId: string;
	description: string;
	total: Cents;
	// The member who actually fronted the money.
	paidBy: string;
	// ISO-8601 calendar date, no time component. Expenses are day-grained.
	date: string;
	split: Split;
}

// Net position per member id. Positive means the group owes them, negative
// means they owe the group. Balances always sum to zero, which is the cheapest
// assertion available that the split math did not lose a cent.
export type Balances = Record<string, Cents>;

// One payment that moves a group closer to square. Produced by settleUp, never
// stored: transfers are recomputed from balances every time, so marking one
// paid is just another expense.
export interface Transfer {
	// Member id paying.
	from: string;
	// Member id being paid.
	to: string;
	amount: Cents;
}
