<script lang="ts">
	import { page } from '$app/state';
	import { ledger } from '$lib/store.svelte.js';
	import BalanceCard from '$lib/components/BalanceCard.svelte';
	import ExpenseForm from '$lib/components/ExpenseForm.svelte';
	import ExpenseList from '$lib/components/ExpenseList.svelte';

	$effect(() => {
		ledger.hydrate();
		ledger.openGroup(page.params.id);
	});

	const group = $derived(ledger.activeGroup);
</script>

{#if !group}
	<p class="empty">That group is gone.</p>
{:else}
	<h1>{group.name}</h1>

	<ExpenseForm {group} onsubmit={(input) => ledger.addExpense(input)} />

	<div class="columns">
		<ExpenseList
			{group}
			expenses={ledger.activeExpenses}
			onremove={(id) => ledger.removeExpense(id)}
		/>
		<BalanceCard {group} balances={ledger.balances} />
	</div>
{/if}

<style>
	h1 {
		font-size: 1.2rem;
		margin: 0;
	}

	.empty {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.columns {
		display: grid;
		grid-template-columns: 1.6fr 1fr;
		gap: 1rem;
		align-items: start;
	}

	@media (max-width: 48rem) {
		.columns {
			grid-template-columns: 1fr;
		}
	}
</style>
