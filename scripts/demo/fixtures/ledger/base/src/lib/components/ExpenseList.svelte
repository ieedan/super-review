<script lang="ts">
	import type { Expense, Group } from '$lib/types.js';
	import { formatAmount } from '$lib/money.js';
	import MemberAvatar from './MemberAvatar.svelte';

	interface Props {
		group: Group;
		expenses: Expense[];
		onremove?: (id: string) => void;
	}

	let { group, expenses, onremove }: Props = $props();

	const byId = $derived(new Map(group.members.map((m) => [m.id, m])));

	function payer(expense: Expense) {
		return byId.get(expense.paidBy);
	}

	function shortDate(iso: string): string {
		return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<section class="card">
	<header>
		<h2>Expenses</h2>
		<span class="count">{expenses.length}</span>
	</header>

	{#if expenses.length === 0}
		<p class="empty">Nothing logged yet. Add the first expense and the balances fill in.</p>
	{:else}
		<ul>
			{#each expenses as expense (expense.id)}
				{@const member = payer(expense)}
				<li>
					<span class="date">{shortDate(expense.date)}</span>
					<span class="description">{expense.description}</span>
					{#if member}
						<span class="payer">
							<MemberAvatar {member} size="sm" />
							<span class="payer-name">paid</span>
						</span>
					{/if}
					<span class="amount">{formatAmount(expense.total, group.currency)}</span>
					{#if onremove}
						<button class="remove" onclick={() => onremove?.(expense.id)} aria-label="Remove">
							&times;
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.card {
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1rem 1.25rem;
		background: var(--surface);
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	header h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.count {
		font-size: 0.75rem;
		color: var(--muted);
		background: var(--surface-muted);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
	}

	.empty {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}

	li {
		display: grid;
		grid-template-columns: 3.5rem 1fr auto auto auto;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--border-subtle);
	}

	li:last-child {
		border-bottom: none;
	}

	.date {
		font-size: 0.78rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.payer {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.payer-name {
		font-size: 0.75rem;
		color: var(--muted);
	}

	.amount {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.remove {
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0 0.25rem;
	}

	.remove:hover {
		color: var(--negative);
	}
</style>
