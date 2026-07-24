<script lang="ts">
	import type { Group, Transfer } from '$lib/types.js';
	import { formatAmount } from '$lib/money.js';
	import MemberAvatar from './MemberAvatar.svelte';

	interface Props {
		group: Group;
		transfers: Transfer[];
		onsettle?: (transfer: Transfer) => void;
	}

	let { group, transfers, onsettle }: Props = $props();

	const byId = $derived(new Map(group.members.map((m) => [m.id, m])));
</script>

<section class="sheet">
	<header>
		<h2>Settle up</h2>
		<p class="hint">
			The shortest set of payments that clears the group. Pay these and everyone is square.
		</p>
	</header>

	{#if transfers.length === 0}
		<p class="settled">Everyone is square. Nothing to pay.</p>
	{:else}
		<ul>
			{#each transfers as transfer}
				{@const from = byId.get(transfer.from)}
				{@const to = byId.get(transfer.to)}
				<li>
					{#if from}
						<MemberAvatar member={from} size="sm" />
						<span class="name">{from.name}</span>
					{/if}
					<span class="arrow" aria-label="pays">&rarr;</span>
					{#if to}
						<MemberAvatar member={to} size="sm" />
						<span class="name">{to.name}</span>
					{/if}
					<span class="amount">{formatAmount(transfer.amount, group.currency)}</span>
					<button class="settle" onclick={() => onsettle?.(transfer)}>Mark paid</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.sheet {
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

	.settled {
		margin: 0;
		font-size: 0.85rem;
		color: var(--positive);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}

	li {
		display: grid;
		grid-template-columns: auto auto auto auto auto 1fr auto;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.9rem;
	}

	.arrow {
		color: var(--muted);
		padding: 0 0.15rem;
	}

	.amount {
		justify-self: end;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.settle {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-muted);
		color: inherit;
		font: inherit;
		font-size: 0.78rem;
		padding: 0.2rem 0.55rem;
		cursor: pointer;
	}

	.settle:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
