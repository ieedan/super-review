<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth-client';
	import { Spinner } from '@super-review/ui/components/ui/spinner';

	let { data } = $props();

	// The server load guaranteed we're signed in; kick off the better-auth Stripe
	// upgrade, which redirects to Checkout. Fall back to the pricing section on
	// failure. The success/cancel URLs must be absolute: better-auth's
	// callback-URL check rejects relative paths that contain a `#` fragment.
	onMount(async () => {
		const origin = window.location.origin;
		try {
			await authClient.subscription.upgrade({
				plan: 'pro',
				annual: data.annual,
				successUrl: `${origin}/dashboard?checkout=success`,
				// /pricing rather than the homepage anchor: that section is hidden in
				// waitlist mode, so cancelling would dump them on the home page.
				// Absolute and fragment-free, which is what better-auth accepts.
				cancelUrl: `${origin}/pricing`
			});
		} catch {
			window.location.href = '/pricing';
		}
	});
</script>

<svelte:head><title>Redirecting to checkout - Super Review</title></svelte:head>

<main class="text-muted-foreground flex min-h-screen flex-col items-center justify-center gap-3">
	<Spinner class="size-6" />
	<p class="text-sm">Setting up your checkout...</p>
</main>
