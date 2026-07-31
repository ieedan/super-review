<script lang="ts">
	import LicenseCard from '@super-review/ui/components/LicenseCard.svelte';
</script>

<main class="bg-bg mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-10 px-4 py-16">
	<LicenseCard plan="Perpetual" holder="Aidan Bleser" activeSince={Date.parse('2026-07-01')} />
</main>
