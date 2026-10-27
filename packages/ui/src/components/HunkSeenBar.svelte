<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Eye from '@lucide/svelte/icons/eye';
	import { actions } from '@super-review/ui/store.svelte';

	// The "Mark seen" bar hung under a hunk by DiffFileSection when the "Mark seen
	// per hunk" setting is on. `hashes` is every hunk in the file (in order), so
	// the store can tell when the last one is marked and the file becomes seen.
	let { path, hash, hashes }: { path: string; hash: string; hashes: string[] } = $props();

	const seen = $derived(actions.isHunkSeen(path, hash));
</script>

<div
	class="flex h-7 items-center justify-end border-y border-border bg-muted/40 px-2 font-sans select-none"
>
	<button
		type="button"
		class={[
			'inline-flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] leading-none transition-colors focus-visible:outline-none',
			seen
				? 'text-muted-foreground hover:bg-accent hover:text-foreground'
				: 'bg-background text-foreground ring-1 ring-border hover:bg-accent'
		]}
		data-hunk-seen-bar
		aria-pressed={seen}
		onclick={() => actions.toggleHunkSeen(path, hash, hashes)}
	>
		{#if seen}
			<Check class="size-3" /> Hunk seen
		{:else}
			<Eye class="size-3" /> Mark hunk seen
		{/if}
	</button>
</div>
