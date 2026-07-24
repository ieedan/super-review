import type { Expense, Group } from './types.js';

// Persistence. localStorage for now: Ledger is a single-device app until it is
// not, and everything here is small enough that a JSON blob per key is fine.
// The read path is deliberately forgiving, since a half-written or
// schema-drifted blob should show an empty group rather than a white screen.

const GROUPS_KEY = 'ledger:groups';
const EXPENSES_KEY = 'ledger:expenses';

function read<T>(key: string, fallback: T): T {
	if (typeof localStorage === 'undefined') return fallback;
	const raw = localStorage.getItem(key);
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(key, JSON.stringify(value));
}

export function loadGroups(): Group[] {
	return read<Group[]>(GROUPS_KEY, []);
}

export function saveGroups(groups: Group[]): void {
	write(GROUPS_KEY, groups);
}

export function loadExpenses(): Expense[] {
	return read<Expense[]>(EXPENSES_KEY, []);
}

export function saveExpenses(expenses: Expense[]): void {
	write(EXPENSES_KEY, expenses);
}
