<script lang="ts">
	import Button from '@super-review/ui/components/button.svelte';
	import Check from '@lucide/svelte/icons/check';
	import { env } from '$lib/env.client';
	import { useQuery } from '$lib/convex.svelte';
	import { api } from '$lib/convex/_generated/api';

	// Base delay for the page-load reveal cascade. The homepage passes ~1760ms so
	// pricing comes in last after the feature sections; the standalone /pricing
	// page uses the default 0 so it animates in promptly.
	let { revealDelay = 0 }: { revealDelay?: number } = $props();

	// The lifetime deal is only offered during the launch window. This mirrors the
	// server-side LAUNCH_CUTOFF, which is what actually enforces it.
	const launchOpen = Date.now() < Date.parse(env.PUBLIC_LAUNCH_CUTOFF);

	let annual = $state(true);

	// Monthly billed yearly works out cheaper; surface the saving on the toggle.
	const MONTHLY = 12;
	const YEARLY = 120;
	const LIFETIME = 100;
	const yearlySavings = MONTHLY * 12 - YEARLY;

	const subFeatures = ['Cancel anytime', 'Unlimited devices', 'Get every update'];
	const lifetimeFeatures = ['Pay once, use forever', 'Unlimited devices', 'Get every update'];

	// Both CTAs link to the checkout routes, which sign the user in first (if
	// needed) and then hand off to Stripe — so we never call the authed action
	// from this public, possibly-signed-out page.

	// Soft-auth: getMine returns the 'unauthenticated' sentinel (not an error)
	// when signed out, so this is safe on the public page. It lets the CTAs read
	// the current plan: a trial upgrades, and an existing paid plan shows as
	// current instead of offering to buy again.
	const licenseQuery = useQuery(api.licenses.getMine, {});
	const currentLicense = $derived.by(() => {
		const d = licenseQuery.data;
		return !d || d === 'unauthenticated' ? null : d;
	});
	const hasLifetime = $derived(
		currentLicense?.plan === 'lifetime' && currentLicense.status === 'active'
	);
	const hasPaidSub = $derived(
		(currentLicense?.plan === 'monthly' || currentLicense?.plan === 'annual') &&
			currentLicense.status === 'active'
	);
	const onTrial = $derived(currentLicense?.plan === 'trial');

	const lifetimeCta = $derived(
		hasLifetime
			? { label: 'Current plan', disabled: true }
			: { label: 'Get perpetual access', disabled: false }
	);
	const subCta = $derived.by(() => {
		if (hasLifetime) return { label: 'Included with Perpetual', disabled: true };
		if (hasPaidSub) return { label: 'Current plan', disabled: true };
		if (onTrial) return { label: 'Upgrade', disabled: false };
		// The 7-day trial comes from the app (activation), not from subscribing, so
		// this button goes straight to a charged subscription: label it honestly.
		return { label: 'Subscribe', disabled: false };
	});
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
		Start with a 7-day free trial.
	</p>

	<div
		class="reveal mt-10 grid w-full max-w-3xl gap-5 {launchOpen ? 'md:grid-cols-2' : 'max-w-md'}"
		style="animation-delay: {revealDelay + 160}ms"
	>
		{#if launchOpen}
			<!-- Lifetime (launch only) -->
			<div
				class="border-flame/40 bg-elevated relative flex flex-col gap-5 rounded-2xl border p-6 sm:p-7"
			>
				<!-- Opaque flame tint (same color as flame/15 over the page bg) so the
					card border doesn't show through where the badge straddles it. -->
				<span
					class="text-flame absolute -top-3 left-6 rounded-full bg-[color-mix(in_srgb,var(--color-flame)_15%,var(--color-base))] px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase"
				>
					Launch offer
				</span>
				<div>
					<h3 class="font-display text-lg font-bold">Perpetual</h3>
					<div class="mt-1 flex items-baseline gap-1.5">
						<span class="text-4xl font-extrabold tracking-tight">${LIFETIME}</span>
						<span class="text-muted-foreground text-sm font-medium">once</span>
					</div>
					<p class="text-muted-foreground mt-1 text-sm">Available during launch only.</p>
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
		{/if}

		<!-- Subscription (monthly / yearly toggle) -->
		<div class="border-line bg-elevated flex flex-col gap-5 rounded-2xl border p-6 sm:p-7">
			<div>
				<div class="flex items-center justify-between gap-3">
					<h3 class="font-display text-lg font-bold">{annual ? 'Yearly' : 'Monthly'}</h3>
					<!-- billing period toggle -->
					<div
						class="border-line inline-flex items-center rounded-full border p-0.5 text-xs font-semibold"
					>
						<button
							type="button"
							onclick={() => (annual = false)}
							class="rounded-full px-3 py-1 transition-colors {annual
								? 'text-muted-foreground hover:text-fg'
								: 'bg-fg text-base'}"
						>
							Monthly
						</button>
						<button
							type="button"
							onclick={() => (annual = true)}
							class="rounded-full px-3 py-1 transition-colors {annual
								? 'bg-fg text-base'
								: 'text-muted-foreground hover:text-fg'}"
						>
							Yearly
						</button>
					</div>
				</div>

				<div class="mt-1 flex items-baseline gap-1.5">
					<span class="text-4xl font-extrabold tracking-tight">${annual ? YEARLY : MONTHLY}</span>
					<span class="text-muted-foreground text-sm font-medium"
						>{annual ? '/year' : '/month'}</span
					>
				</div>
				<p class="text-muted-foreground mt-1 text-sm">
					{#if annual}
						Billed yearly. <span class="text-flame font-medium">Save ${yearlySavings}</span> vs monthly.
					{:else}
						Billed monthly. Switch to yearly to save ${yearlySavings}.
					{/if}
				</p>
			</div>
			<ul class="flex flex-col gap-2 text-sm">
				{#each subFeatures as feature (feature)}
					<li class="flex items-center gap-2">
						<Check class="text-flame size-4 shrink-0" />
						<span>{feature}</span>
					</li>
				{/each}
			</ul>
			<Button
				href={subCta.disabled ? undefined : `/checkout/subscribe?annual=${annual}`}
				variant={launchOpen ? 'outline' : 'default'}
				disabled={subCta.disabled}
				class="mt-auto h-11 w-full rounded-xl"
			>
				{subCta.label}
			</Button>
		</div>
	</div>
</section>
