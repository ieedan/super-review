import type { Balances, Expense, Group, Member } from './types.js';
import { equalSplit } from './split.js';
import { loadExpenses, loadGroups, saveExpenses, saveGroups } from './db.js';

// App state. One instance, created at the bottom of this file and imported
// everywhere, because Ledger has exactly one open group at a time and threading
// a context through four component layers buys nothing.

class LedgerStore {
	groups = $state<Group[]>([]);
	expenses = $state<Expense[]>([]);
	activeGroupId = $state<string | null>(null);

	// The group currently on screen. Null before hydrate() runs, or if the
	// stored active id points at a group that has since been deleted.
	activeGroup = $derived(this.groups.find((g) => g.id === this.activeGroupId) ?? null);

	// Expenses for the active group, newest first. The list view renders this
	// directly, so the sort lives here rather than in the component.
	activeExpenses = $derived(
		this.expenses
			.filter((e) => e.groupId === this.activeGroupId)
			.sort((a, b) => b.date.localeCompare(a.date))
	);

	// Net position per member. Positive means the group owes them.
	balances = $derived.by<Balances>(() => {
		const group = this.activeGroup;
		if (!group) return {};

		const balances: Balances = {};
		for (const member of group.members) balances[member.id] = 0;

		for (const expense of this.activeExpenses) {
			balances[expense.paidBy] = (balances[expense.paidBy] ?? 0) + expense.total;
			for (const [memberId, share] of Object.entries(expense.split.shares)) {
				balances[memberId] = (balances[memberId] ?? 0) - share;
			}
		}

		return balances;
	});

	hydrate(): void {
		this.groups = loadGroups();
		this.expenses = loadExpenses();
		this.activeGroupId = this.groups[0]?.id ?? null;
	}

	openGroup(groupId: string): void {
		this.activeGroupId = groupId;
	}

	addMember(groupId: string, member: Member): void {
		const group = this.groups.find((g) => g.id === groupId);
		if (!group) return;
		group.members = [...group.members, member];
		saveGroups(this.groups);
	}

	// Add an expense split evenly across everyone in the group. The form is the
	// only caller today, which is why the split strategy is hardcoded here.
	addExpense(input: { description: string; total: number; paidBy: string; date: string }): void {
		const group = this.activeGroup;
		if (!group) return;

		const expense: Expense = {
			id: crypto.randomUUID(),
			groupId: group.id,
			description: input.description,
			total: input.total,
			paidBy: input.paidBy,
			date: input.date,
			split: equalSplit(
				input.total,
				group.members.map((m) => m.id)
			)
		};

		this.expenses = [...this.expenses, expense];
		saveExpenses(this.expenses);
	}

	removeExpense(expenseId: string): void {
		this.expenses = this.expenses.filter((e) => e.id !== expenseId);
		saveExpenses(this.expenses);
	}
}

export const ledger = new LedgerStore();
