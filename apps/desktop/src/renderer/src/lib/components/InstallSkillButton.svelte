<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { Button } from './ui/button';
	import { actions } from '$lib/store.svelte';

	// Installs the super-review skill into the active repo. Visibility is the
	// caller's call (e.g. the sessions empty state only shows it when the skill
	// is missing) — this is just the button.
	let installing = $state(false);

	async function install(): Promise<void> {
		if (installing) return;
		installing = true;
		try {
			await actions.installSkill();
		} finally {
			installing = false;
		}
	}
</script>

<Button onclick={install} disabled={installing} size="sm">
	{#if installing}
		<Loader2 class="size-3.5 animate-spin" />
		Installing…
	{:else}
		<Download class="size-3.5" />
		Install skill
	{/if}
</Button>
