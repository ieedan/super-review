<script lang="ts">
	import type { Balances, Group } from '$lib/types.js';
	import { formatMagnitude } from '$lib/money.js';
	import MemberAvatar from './MemberAvatar.svelte';

	interface Props {
		group: Group;
		balances: Balances;
	}

	let { group, balances }: Props = $props();

	// Biggest creditor first, biggest debtor last. Members who are square sit in
	// the middle and read as a quiet row, which is the point.
	const rows = $derived(
		group.members
			.map((member) => ({ member, amount: balances[member.id] ?? 0 }))
			.sort((a, b) => b.amount - a.amount)
	);

	function label(amount: number): string {
		if (amount === 0) return 'settled up';
		return amount > 0 ? 'is owed' : 'owes';
	}
</script>

<section class="card">
	<header>
		<h2>Balances</h2>
		<p class="hint">Who is up and who is down across every expense in this group.</p>
	</header>

	<ul>
		{#each rows as row (row.member.id)}
			<li class:settled={row.amount === 0}>
				<MemberAvatar member={row.member} size="sm" />
				<span class="name">{row.member.name}</span>
				<span class="label">{label(row.amount)}</span>
				<span class="amount" class:positive={row.amount > 0} class:negative={row.amount < 0}>
					{row.amount === 0 ? '' : formatMagnitude(row.amount, group.currency)}
				</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.card {
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1rem 1.25rem;
		background: var(--surface);
	}

	header h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.hint {
		margin: 0.25rem 0 0.75rem;
		font-size: 0.8rem;
		color: var(--muted);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	li {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
	}

	li.settled {
		color: var(--muted);
	}

	.label {
		font-size: 0.8rem;
		color: var(--muted);
	}

	.amount {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.positive {
		color: var(--positive);
	}

	.negative {
		color: var(--negative);
	}
</style>
