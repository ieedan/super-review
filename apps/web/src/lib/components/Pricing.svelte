<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '@super-review/ui/components/button.svelte';
	import Check from '@lucide/svelte/icons/check';
	import { useQuery } from '$lib/convex.svelte';
	import { api } from '$lib/convex/_generated/api';
	import { DOWNLOADS, detectOS, type OS } from '$lib/releases';
	import OsIcon from '$lib/components/OsIcon.svelte';
	import { env } from '$lib/env.client';
	import { BASE_PRICE, LAUNCH_PRICE, formatPrice, isLaunchOpen, launchLastDay } from '$lib/pricing';

	// Base delay for the page-load reveal cascade. The homepage passes ~1760ms so
	// pricing comes in last after the feature sections; the standalone /pricing
	// page uses the default 0 so it animates in promptly.
	let { revealDelay = 0 }: { revealDelay?: number } = $props();

	// One product, paid once, at one of two prices. This mirrors the server-side
	// LAUNCH_CUTOFF, which is what actually picks the Stripe price at checkout.
	const launchOpen = isLaunchOpen(env.PUBLIC_LAUNCH_CUTOFF, Date.now());
	const price = launchOpen ? LAUNCH_PRICE : BASE_PRICE;
	// The last day the launch price holds, derived from the same cutoff so the
	// promise on the card cannot outlive the discount at checkout.
	const lastDay = launchLastDay(env.PUBLIC_LAUNCH_CUTOFF);
	const lastDayLabel = lastDay?.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

	const lifetimeFeatures = [
		'Pay once, use forever',
		'Unlimited devices',
		'Get every update',
		'No subscription'
	];

	// The CTA links to the checkout route, which signs the user in first (if
	// needed) and then hands off to Stripe — so we never call the authed action
	// from this public, possibly-signed-out page.

	// Soft-auth: getMine returns the 'unauthenticated' sentinel (not an error)
	// when signed out, so this is safe on the public page. It lets the CTA read
	// the current plan, so an existing owner sees it as current instead of being
	// offered the same purchase again.
	const licenseQuery = useQuery(api.licenses.getMine, {});
	const currentLicense = $derived.by(() => {
		const d = licenseQuery.data;
		return !d || d === 'unauthenticated' ? null : d;
	});
	const hasLifetime = $derived(
		currentLicense?.plan === 'lifetime' && currentLicense.status === 'active'
	);

	const lifetimeCta = $derived(
		hasLifetime
			? { label: 'Current plan', disabled: true }
			: { label: 'Get perpetual access', disabled: false }
	);

	// The free trial is started by downloading and activating the desktop app (it
	// is the one free window per account), so the trial CTA is a download link,
	// not a checkout link. /api/download/<os> is auth-gated: signed-out visitors
	// are sent through sign-in first, then the download. Default to macOS until the
	// client sniffs the real OS (detectOS needs navigator, absent during SSR).
	let detected = $state<OS>('other');
	onMount(() => {
		detected = detectOS();
	});
	const trialOs = $derived<'mac' | 'windows'>(detected === 'windows' ? 'windows' : 'mac');
	const otherOs = $derived<'mac' | 'windows'>(trialOs === 'mac' ? 'windows' : 'mac');

	// The two marks need different sizes to read as the same weight beside the
	// label: the Apple logo fills its viewBox top to bottom, so at a square 16px
	// it towers over the text's cap height, while the Windows tiles are square and
	// sit right at 16px.
	const trialIconSize = $derived(trialOs === 'mac' ? 'size-3.5' : 'size-4');
</script>

<section
	id="pricing"
	class="border-line flex scroll-mt-24 flex-col items-center border-t py-16 sm:py-20"
	aria-label="Pricing"
>
	<h2
		class="reveal font-display text-2xl font-bold tracking-tight text-balance sm:text-3xl"
		style="animation-delay: {revealDelay}ms"
	>
		Ready to actually <span class="flame-text">read the code?</span>
	</h2>
	<p
		class="text-muted-foreground reveal mt-3 max-w-md text-center text-pretty"
		style="animation-delay: {revealDelay + 80}ms"
	>
		Start with a 7-day free trial. No card required.
	</p>

	<div
		class="reveal mt-8 flex flex-col items-center gap-2"
		style="animation-delay: {revealDelay + 120}ms"
	>
		<Button href={DOWNLOADS[trialOs].url} class="h-11 gap-2 rounded-xl px-6">
			<!-- fill-current so the Windows mark drops its brand blue and picks up the
				button's foreground; a CSS fill beats the svg's fill attribute. -->
			<OsIcon platform={trialOs} class="{trialIconSize} fill-current" />
			Download for {DOWNLOADS[trialOs].label}
		</Button>
		<a
			href={DOWNLOADS[otherOs].url}
			class="text-muted-foreground hover:text-fg text-xs transition-colors"
		>
			or download for {DOWNLOADS[otherOs].label}
		</a>
	</div>

	<div class="reveal mt-10 w-full max-w-md" style="animation-delay: {revealDelay + 200}ms">
		<div
			class="border-flame/40 bg-elevated relative flex flex-col gap-5 rounded-2xl border p-6 sm:p-7"
		>
			{#if launchOpen}
				<!-- Opaque flame tint (same color as flame/15 over the page bg) so the
					card border doesn't show through where the badge straddles it. -->
				<span
					class="text-flame absolute -top-3 left-6 rounded-full bg-[color-mix(in_srgb,var(--color-flame)_15%,var(--color-base))] px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase"
				>
					Launch offer
				</span>
			{/if}
			<div>
				<h3 class="font-display text-lg font-bold">Perpetual</h3>
				<div class="mt-1 flex items-baseline gap-2">
					<span class="text-4xl font-extrabold tracking-tight">{formatPrice(price)}</span>
					{#if launchOpen}
						<span class="text-muted-foreground text-xl font-semibold line-through">
							{formatPrice(BASE_PRICE)}
						</span>
					{/if}
					<span class="text-muted-foreground text-sm font-medium">once</span>
				</div>
				<p class="text-muted-foreground mt-1 text-sm">
					{#if launchOpen && lastDayLabel}
						Launch price through {lastDayLabel}. Yours for good.
					{:else}
						One payment. Yours for good.
					{/if}
				</p>
			</div>
			<ul class="flex flex-col gap-2 text-sm">
				{#each lifetimeFeatures as feature (feature)}
					<li class="flex items-center gap-2">
						<Check class="text-flame size-4 shrink-0" />
						<span>{feature}</span>
					</li>
				{/each}
			</ul>
			<Button
				href={lifetimeCta.disabled ? undefined : '/checkout/lifetime'}
				disabled={lifetimeCta.disabled}
				class="mt-auto h-11 w-full rounded-xl"
			>
				{lifetimeCta.label}
			</Button>
		</div>
	</div>
</section>
