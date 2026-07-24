<script lang="ts">
	import { ledger } from '$lib/store.svelte.js';
	import MemberAvatar from '$lib/components/MemberAvatar.svelte';

	$effect(() => {
		ledger.hydrate();
	});
</script>

<h1>Your groups</h1>

{#if ledger.groups.length === 0}
	<p class="empty">No groups yet. Start one and add the people you split with.</p>
{:else}
	<ul class="groups">
		{#each ledger.groups as group (group.id)}
			<li>
				<a href="/groups/{group.id}">
					<span class="name">{group.name}</span>
					<span class="members">
						{#each group.members as member (member.id)}
							<MemberAvatar {member} size="sm" />
						{/each}
					</span>
				</a>
			</li>
		{/each}
	</ul>
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

	.groups {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.groups a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		color: inherit;
		text-decoration: none;
	}

	.members {
		display: inline-flex;
		gap: 0.25rem;
	}
</style>
