<script lang="ts">
	// Direct download tiles for the desktop app. Links resolve to the newest
	// release asset, so there is no version lookup and nothing to keep in sync.
	import { onMount } from 'svelte';
	import { DOWNLOADS, detectOS, type OS } from '$lib/releases';

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

				{#if tile.os === 'mac'}
					<svg viewBox="0 0 814 1000" class="size-10" fill="currentColor" aria-hidden="true">
						<path
							d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
						/>
					</svg>
				{:else}
					<svg viewBox="0 0 88 88" class="size-9" fill="#00adef" aria-hidden="true">
						<path
							d="m0 12.402 35.687-4.86.016 34.423-35.67.203zm35.67 33.529.028 34.453L.028 75.48.026 45.7zm4.326-39.025L87.314 0v41.527l-47.318.376zm47.329 39.349-.011 41.34-47.318-6.678-.066-34.739z"
						/>
					</svg>
				{/if}

				<div class="text-center">
					<div class="text-sm font-semibold">Download for {tile.label}</div>
					<div class="text-muted-foreground text-xs">{tile.requirement}</div>
				</div>
			</a>
		{/each}
	</div>
</section>
