<script lang="ts">
	// Direct download tiles for the desktop app. Links resolve to the newest
	// release asset, so there is no version lookup and nothing to keep in sync.
	import { onMount } from 'svelte';
	import { DOWNLOADS, detectOS, type OS } from '$lib/releases';
	import OsIcon from '$lib/components/OsIcon.svelte';

	let {
		showHeading = true
	}: {
		// The dashboard settings tab already labels this panel, so the page can
		// drop the redundant heading while other surfaces keep it.
		showHeading?: boolean;
	} = $props();

	let detected = $state<OS>('other');
	onMount(() => {
		detected = detectOS();
	});

	const tiles = [
		{ ...DOWNLOADS.mac, requirement: 'Apple silicon' },
		{ ...DOWNLOADS.windows, requirement: '64-bit (x64)' }
	];
</script>

<section class="flex flex-col gap-3">
	{#if showHeading}
		<h2 class="font-display text-lg font-semibold">Download</h2>
	{/if}
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		{#each tiles as tile (tile.os)}
			<a
				href={tile.url}
				download={tile.filename}
				class="border-line bg-elevated hover:border-fg/25 focus-visible:ring-ring group relative flex flex-col items-center gap-3 rounded-xl border px-4 py-8 transition-colors focus-visible:ring-2 focus-visible:outline-none"
			>
				{#if detected === tile.os}
					<span
						class="border-line text-muted-foreground absolute top-3 right-3 rounded-full border px-2 py-0.5 text-[10px] font-medium"
					>
						Your device
					</span>
				{/if}

				<OsIcon platform={tile.os} class={tile.os === 'mac' ? 'size-10' : 'size-9'} />

				<div class="text-center">
					<div class="text-sm font-semibold">Download for {tile.label}</div>
					<div class="text-muted-foreground text-xs">{tile.requirement}</div>
				</div>
			</a>
		{/each}
	</div>
</section>
