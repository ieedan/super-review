<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import Pricing from '$lib/components/Pricing.svelte';
	import Footer from '$lib/components/Footer.svelte';

	// Always the real plans. Pre-launch this route is gated to signed-in beta
	// members in +page.server.ts rather than replaced with a waitlist form:
	// invited users arrive here from the desktop Upgrade link and need to buy,
	// while non-invited accounts are sent back to the dashboard.
	// The homepage pricing section stays hidden in waitlist mode; that is the
	// surface we don't publish prices on.
</script>

<svelte:head>
	<title>Pricing - Super Review</title>
	<meta
		name="description"
		content="Super Review pricing: start with a 7-day free trial, then one payment for a perpetual license. No subscription."
	/>
	<link rel="canonical" href="https://superreview.dev/pricing" />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Super Review" />
	<meta property="og:url" content="https://superreview.dev/pricing" />
	<meta property="og:title" content="Pricing - Super Review" />
	<meta
		property="og:description"
		content="Start with a 7-day free trial, then one payment for a perpetual license. No subscription."
	/>
	<meta property="og:image" content="https://superreview.dev/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Pricing - Super Review" />
	<meta
		name="twitter:description"
		content="Start with a 7-day free trial, then one payment for a perpetual license. No subscription."
	/>
	<meta name="twitter:image" content="https://superreview.dev/og.png" />
</svelte:head>

<div class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-6">
	<Header />
	<Pricing />
	<div class="flex-1"></div>
	<Footer />
</div>
