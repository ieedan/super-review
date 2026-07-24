<script lang="ts">
	import type { Group } from '$lib/types.js';

	interface Props {
		group: Group;
		onsubmit: (input: {
			description: string;
			total: number;
			paidBy: string;
			date: string;
		}) => void;
	}

	let { group, onsubmit }: Props = $props();

	let description = $state('');
	let amount = $state('');
	let paidBy = $state(group.members[0]?.id ?? '');
	let date = $state(new Date().toISOString().slice(0, 10));

	// TODO: this duplicates what every other amount input will need. Pull it out
	// into money.ts the next time something else has to read a typed amount.
	const total = $derived(Math.round(Number(amount) * 100));
	const valid = $derived(description.trim().length > 0 && Number.isFinite(total) && total > 0);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!valid) return;

		onsubmit({ description: description.trim(), total, paidBy, date });

		description = '';
		amount = '';
	}
</script>

<form onsubmit={submit}>
	<input class="description" placeholder="What was it for?" bind:value={description} />
	<input class="amount" inputmode="decimal" placeholder="0.00" bind:value={amount} />

	<select bind:value={paidBy} aria-label="Paid by">
		{#each group.members as member (member.id)}
			<option value={member.id}>{member.name}</option>
		{/each}
	</select>

	<input class="date" type="date" bind:value={date} />

	<button type="submit" disabled={!valid}>Add</button>
</form>

<style>
	form {
		display: grid;
		grid-template-columns: 1fr 6rem 9rem 9rem auto;
		gap: 0.5rem;
		align-items: center;
	}

	input,
	select {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
		background: var(--surface);
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}

	.amount {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	button {
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 0.45rem 0.9rem;
		background: var(--accent);
		color: white;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
