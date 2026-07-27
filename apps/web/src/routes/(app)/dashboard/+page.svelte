<script lang="ts">
	import { tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { fade, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { useConvexClient } from '$lib/convex.svelte';
	import { api } from '$lib/convex/_generated/api';
	import { Button } from '@super-review/ui/components/ui/button';
	import { Input } from '@super-review/ui/components/ui/input';
	import LicenseCard from '@super-review/ui/components/LicenseCard.svelte';
	import DownloadButtons from '$lib/components/DownloadButtons.svelte';
	import InvitePanel from '$lib/components/InvitePanel.svelte';
	import OsIcon from '$lib/components/OsIcon.svelte';
	import * as Avatar from '@super-review/ui/components/ui/avatar';
	import { cn } from '@super-review/ui/utils';
	import House from '@lucide/svelte/icons/house';
	import Monitor from '@lucide/svelte/icons/monitor';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import LogOut from '@lucide/svelte/icons/log-out';
	import type { LucideIcon } from '@lucide/svelte';

	let { data } = $props();
	const convex = useConvexClient();
	const isDesktop = new MediaQuery('min-width: 768px');
	const reduceMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	const menuAnimMs = $derived(reduceMotion.current ? 0 : 220);

	// SSR-loaded (via convexLoad) and upgraded to a live subscription on the
	// client, so these render with no loading flash and update in place.
	//
	// The live queries are soft-auth: whenever the WebSocket is momentarily
	// unauthenticated (hydration, token refresh, tab refocus) they resolve the
	// 'unauthenticated' sentinel instead of erroring. Hold the last real value
	// through those blips so the page never flashes empty while auth settles.
	function settled<T>(value: T | 'unauthenticated'): T | undefined {
		return value === 'unauthenticated' ? undefined : value;
	}
	// Seeding from the SSR snapshot on purpose; the $effects below track updates.
	// svelte-ignore state_referenced_locally
	let lastLicense = $state(settled(data.license.data));
	// svelte-ignore state_referenced_locally
	let lastDevices = $state(settled(data.devices.data));
	$effect(() => {
		if (data.license.data !== 'unauthenticated') lastLicense = data.license.data;
	});
	$effect(() => {
		if (data.devices.data !== 'unauthenticated') lastDevices = data.devices.data;
	});
	const license = $derived(
		data.license.data === 'unauthenticated' ? (lastLicense ?? null) : data.license.data
	);
	const devices = $derived(
		data.devices.data === 'unauthenticated' ? (lastDevices ?? []) : data.devices.data
	);

	const invites = $derived(data.invites.data === 'unauthenticated' ? null : data.invites.data);
	// Only hide the downloads when we positively know the account is waiting.
	// While the query is settling we show them: this panel is presentation, and
	// the download route and activation both re-check server-side, so guessing
	// wrong here is cosmetic rather than a hole.
	const waitlistPending = $derived(!!invites && invites.waitlistMode && !invites.isMember);

	const planNames = { lifetime: 'Perpetual', monthly: 'Monthly', annual: 'Annual' } as const;
	// Active paid licenses get the metal card; everything else keeps the
	// plain status panel.
	const cardPlan = $derived.by(() => {
		const l = license;
		if (!l || l.status !== 'active') return undefined;
		return l.plan === 'lifetime' || l.plan === 'monthly' || l.plan === 'annual'
			? (l.plan as keyof typeof planNames)
			: undefined;
	});

	// Recurring plans (or a leftover Stripe subscription id) get the Billing
	// tab's subscription summary. Lifetime is a one-time purchase, not a sub.
	const subscriptionPlan = $derived.by(() => {
		const l = license;
		if (!l) return undefined;
		if (l.plan === 'monthly' || l.plan === 'annual') return l.plan;
		return undefined;
	});
	const canOpenBillingPortal = $derived(!!license?.stripeCustomerId);

	function statusLabel(plan: string, status: string, trialEndsAt?: number | null): string {
		if (status === 'suspended') return 'Suspended';
		if (plan === 'lifetime') return 'Perpetual - active';
		if (plan === 'trial') {
			if (status !== 'trialing') return 'Trial expired';
			const days = trialEndsAt
				? Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86_400_000))
				: 0;
			return `Trial - ${days} day${days === 1 ? '' : 's'} left`;
		}
		if (plan === 'monthly' || plan === 'annual') {
			return status === 'active' ? `${plan} - active` : `${plan} - lapsed`;
		}
		return 'No active license';
	}

	function formatDate(ms: number): string {
		return new Date(ms).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	let openingPortal = $state(false);
	async function manageBilling(): Promise<void> {
		if (openingPortal) return;
		openingPortal = true;
		try {
			// Absolute URL: better-auth's origin check accepts a ?query on relative
			// paths, but an absolute return URL is the safest way to land back on
			// the billing tab after the Stripe portal.
			await authClient.subscription.billingPortal({
				returnUrl: `${window.location.origin}/dashboard?tab=billing`
			});
		} finally {
			openingPortal = false;
		}
	}

	const initials = $derived(
		(data.account.name || data.account.email)
			.replace(/[^a-zA-Z]/g, '')
			.slice(0, 2)
			.toUpperCase()
	);

	async function signOut(): Promise<void> {
		await authClient.signOut();
		window.location.href = '/';
	}

	// ── Tabs + search (mirrors the desktop Settings dialog jump-list) ──

	type SettingsTab = 'home' | 'devices' | 'billing';

	const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
		{ id: 'home', label: 'Home', icon: House },
		{ id: 'devices', label: 'Devices', icon: Monitor },
		{ id: 'billing', label: 'Billing', icon: CreditCard }
	];

	type SettingsSection = {
		tab: SettingsTab;
		id: string;
		title: string;
		keywords: string;
	};

	const SECTIONS: SettingsSection[] = [
		{
			tab: 'home',
			id: 'settings-download',
			title: 'Download',
			keywords: 'download mac windows app desktop install apple silicon get started home'
		},
		{
			tab: 'home',
			id: 'settings-account',
			title: 'Account',
			keywords: 'account signed in sign out logout email name github profile home'
		},
		{
			tab: 'devices',
			id: 'settings-devices',
			title: 'Your devices',
			keywords: 'device revoke activate platform last validated machine logout'
		},
		{
			tab: 'billing',
			id: 'settings-license',
			title: 'Your license',
			keywords: 'license card perpetual lifetime annual yearly monthly trial upgrade active since'
		},
		{
			tab: 'billing',
			id: 'settings-billing',
			title: 'Billing',
			keywords:
				'billing subscription subscribe stripe portal invoice payment renew cancel manage plan monthly annual'
		}
	];

	const TAB_BY_ID = new Map(TABS.map((t) => [t.id, t]));
	const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

	// 'account' and 'download' are the old tabs that Home replaced; keep them
	// resolving so any link still pointing at them lands somewhere sensible.
	const LEGACY_TABS: Record<string, SettingsTab> = { account: 'home', download: 'home' };

	function parseTab(raw: string | null | undefined): SettingsTab {
		if (!raw) return 'home';
		if (TAB_IDS.has(raw)) return raw as SettingsTab;
		return LEGACY_TABS[raw] ?? 'home';
	}

	function tabFromUrl(): SettingsTab {
		return parseTab(page.url.searchParams.get('tab'));
	}

	// Seeded from ?tab= so SSR and the first paint match (no post-mount sync), and
	// written back to the URL on every pick so the tab is linkable and survives a
	// reload (the Stripe portal returns to ?tab=billing).
	//
	// A writable $derived, because it has to move for two different reasons.
	// Picking a tab assigns it directly: shallow routing's replaceState rewrites
	// the address bar and page.state but leaves page.url alone, so a read-only
	// derived would never move on a pick. Real navigations (reload, back/forward,
	// a link into ?tab=billing) do change page.url, and the derived re-runs and
	// takes over again.
	let activeTab = $derived(tabFromUrl());

	let mobileMenuOpen = $state(false);
	let searchQuery = $state('');
	let mobileSearchInput = $state<HTMLElement | null>(null);
	let highlightedIndex = $state(0);

	const trimmedQuery = $derived(searchQuery.trim());
	const searching = $derived(trimmedQuery.length > 0);
	const activeTabMeta = $derived(TAB_BY_ID.get(activeTab) ?? TABS[0]);

	type SearchHit = { section: SettingsSection; tabLabel: string };
	const searchResults = $derived.by<SearchHit[]>(() => {
		if (!searching) return [];
		const terms = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
		const hits: SearchHit[] = [];
		for (const s of SECTIONS) {
			const tabLabel = TAB_BY_ID.get(s.tab)?.label ?? '';
			const haystack = `${s.title} ${s.keywords} ${tabLabel}`.toLowerCase();
			if (terms.every((t) => haystack.includes(t))) hits.push({ section: s, tabLabel });
		}
		return hits;
	});

	$effect(() => {
		void trimmedQuery;
		highlightedIndex = 0;
	});

	// Close the mobile sheet when the viewport crosses into desktop; the sheet
	// is md:hidden so leaving it open would only confuse keyboard focus.
	$effect(() => {
		if (isDesktop.current && mobileMenuOpen) mobileMenuOpen = false;
	});

	function setTabInUrl(id: SettingsTab): void {
		// Read the address bar, not page.url: replaceState leaves page.url on
		// whatever the last real navigation loaded, so comparing against it would
		// go stale the moment the first tab is picked.
		const here = new URL(window.location.href);
		const url = new URL(here);
		if (id === 'home') url.searchParams.delete('tab');
		else url.searchParams.set('tab', id);
		const next = `${url.pathname}${url.search}${url.hash}`;
		if (next === `${here.pathname}${here.search}${here.hash}`) return;
		replaceState(next, page.state);
	}

	function selectTab(id: SettingsTab): void {
		searchQuery = '';
		mobileMenuOpen = false;
		activeTab = id;
		setTabInUrl(id);
	}

	function goToSetting(section: SettingsSection): void {
		searchQuery = '';
		mobileMenuOpen = false;
		activeTab = section.tab;
		setTabInUrl(section.tab);
		void tick().then(async () => {
			await tick();
			const el = document.getElementById(section.id);
			if (!el) return;
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			flashElement(el);
		});
	}

	function flashElement(el: HTMLElement): void {
		for (const a of el.getAnimations?.() ?? []) {
			if (a.id === 'settings-flash') a.cancel();
		}
		const anim = el.animate(
			[
				{ backgroundColor: 'rgba(249, 115, 22, 0.3)' },
				{ backgroundColor: 'rgba(249, 115, 22, 0)' }
			],
			{ duration: 3000, easing: 'linear' }
		);
		anim.id = 'settings-flash';
	}

	function handleSearchKey(e: KeyboardEvent): void {
		const n = searchResults.length;
		if (searching && n > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			highlightedIndex =
				e.key === 'ArrowDown' ? (highlightedIndex + 1) % n : (highlightedIndex - 1 + n) % n;
			void tick().then(() => {
				document
					.querySelector(`[data-search-result="${highlightedIndex}"]`)
					?.scrollIntoView({ block: 'nearest' });
			});
			return;
		}
		if (searching && e.key === 'Enter') {
			e.preventDefault();
			const hit = searchResults[highlightedIndex];
			if (hit) goToSetting(hit.section);
			return;
		}
		if (e.key === 'Escape' && searchQuery) {
			e.preventDefault();
			e.stopPropagation();
			searchQuery = '';
			return;
		}
		if (e.key === 'Escape' && mobileMenuOpen) {
			e.preventDefault();
			mobileMenuOpen = false;
		}
	}

	async function openMobileMenu(): Promise<void> {
		mobileMenuOpen = true;
		await tick();
		mobileSearchInput?.focus();
	}
</script>

<svelte:head><title>Settings - Super Review</title></svelte:head>

<div class="bg-base text-fg min-h-screen">
	<!-- Compact top bar: logo home link on every viewport. -->
	<header class="border-line flex items-center gap-3 border-b px-4 py-3 md:px-6">
		<a href="/" class="flex items-center gap-2.5" aria-label="Super Review home">
			<img src="/icon.png" alt="" class="size-8 rounded-lg shadow-lg" />
			<span class="font-display text-sm font-bold tracking-tight md:text-base">Super Review</span>
		</a>
	</header>

	<div
		class="mx-auto flex w-full max-w-5xl gap-6 px-4 pt-6 pb-28 md:gap-8 md:px-6 md:pt-10 md:pb-16"
	>
		<!-- Desktop sticky tab rail: search sits above the tabs, same as the app Settings dialog.
		     While searching, the tab list is replaced by the jump-list. -->
		<nav
			class="sticky top-6 hidden h-fit w-64 shrink-0 flex-col gap-2 self-start md:flex"
			aria-label="Settings"
		>
			<div class="relative">
				<Search
					class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
				/>
				<Input
					bind:value={searchQuery}
					placeholder="Search settings"
					aria-label="Search settings"
					class="border-line bg-elevated h-9 rounded-xl pr-8 pl-8 text-sm"
					onkeydown={handleSearchKey}
				/>
				{#if searchQuery}
					<button
						type="button"
						title="Clear search"
						class="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md"
						onclick={() => (searchQuery = '')}
					>
						<X class="size-3.5" />
					</button>
				{/if}
			</div>

			{#if searching}
				{#if searchResults.length === 0}
					<p class="text-muted-foreground px-2 py-3 text-xs">
						No settings match “{trimmedQuery}”.
					</p>
				{:else}
					<div
						class="flex max-h-[min(24rem,70vh)] flex-col gap-0.5 overflow-y-auto"
						role="listbox"
						aria-label="Search results"
					>
						{#each searchResults as hit, i (hit.section.id)}
							{@const active = i === highlightedIndex}
							<button
								type="button"
								role="option"
								aria-selected={active}
								data-search-result={i}
								class={cn(
									'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors',
									active
										? 'bg-muted text-foreground'
										: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
								)}
								onmousemove={() => (highlightedIndex = i)}
								onclick={() => goToSetting(hit.section)}
							>
								<span class="min-w-0 flex-1 truncate">{hit.section.title}</span>
								<span class="text-muted-foreground shrink-0 text-[10px]">{hit.tabLabel}</span>
							</button>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="flex flex-col gap-0.5">
					{#each TABS as tab (tab.id)}
						{@const Icon = tab.icon}
						<button
							type="button"
							class={cn(
								'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors',
								activeTab === tab.id
									? 'bg-muted text-foreground'
									: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
							)}
							aria-current={activeTab === tab.id ? 'page' : undefined}
							onclick={() => selectTab(tab.id)}
						>
							<Icon class="size-4 shrink-0" />
							<span class="min-w-0 flex-1 truncate">{tab.label}</span>
						</button>
					{/each}
				</div>
			{/if}
		</nav>

		<!-- Right column: the signed-in account always first (it's the page header,
		     and keeps sign out one click away from every tab), then invites, then
		     tab content. Home leads with the download; the license lives on Billing
		     next to the plan it belongs to. -->
		<div class="flex min-w-0 flex-1 flex-col gap-4">
			<section class="flex flex-col gap-4">
				<div
					id="settings-account"
					class="border-line bg-elevated flex items-center gap-3 rounded-xl border px-3 py-2.5"
				>
					<Avatar.Root class="size-8">
						{#if data.account.image}
							<Avatar.Image src={data.account.image} alt="" />
						{/if}
						<Avatar.Fallback class="text-[10px]">{initials}</Avatar.Fallback>
					</Avatar.Root>
					<div class="min-w-0 flex-1 leading-tight">
						{#if data.account.name}
							<div class="truncate text-sm font-medium">{data.account.name}</div>
						{/if}
						<div class="text-muted-foreground truncate text-xs">{data.account.email}</div>
					</div>
					<Button variant="outline" size="sm" onclick={signOut}>
						<LogOut class="size-3.5" /> Sign out
					</Button>
				</div>

				{#if invites && invites.waitlistMode}
					<InvitePanel
						isMember={invites.isMember}
						onWaitlist={invites.onWaitlist}
						guestCodes={invites.guestCodes}
						referralReward={invites.referralReward}
						email={data.account.email}
						hasPaidPlan={!!cardPlan}
					/>
				{/if}

				{#if activeTab === 'home'}
					<div id="settings-download" class="flex flex-col gap-3">
						{#if waitlistPending}
							<h2 class="font-display text-lg font-semibold">Download</h2>
							<p class="text-muted-foreground text-sm text-pretty">
								Downloads unlock once you redeem an invite code.
							</p>
						{:else}
							<DownloadButtons />
						{/if}
					</div>
				{:else if activeTab === 'devices'}
					<div id="settings-devices" class="flex flex-col gap-3">
						<h2 class="font-display text-lg font-semibold">Your devices</h2>
						{#if !devices || devices.length === 0}
							<p class="text-muted-foreground text-sm">No devices activated yet.</p>
						{:else}
							<ul class="border-line divide-line divide-y rounded-xl border">
								{#each devices as device (device._id)}
									<li class="flex items-center justify-between gap-3 p-3">
										<div class="flex min-w-0 items-center gap-3">
											<OsIcon platform={device.platform} class="size-5 shrink-0" />
											<div class="min-w-0">
												<div class="truncate font-medium">
													{device.name ?? 'Unknown device'}
												</div>
												<div class="text-muted-foreground text-xs">
													Last validated {new Date(device.lastSeenAt).toLocaleDateString()}
												</div>
											</div>
										</div>
										<Button
											variant="destructive"
											onclick={() =>
												convex.safeMutation(api.devices.revoke, { deviceId: device._id })}
										>
											Revoke
										</Button>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{:else if activeTab === 'billing'}
					<div id="settings-license" class="flex flex-col gap-3">
						<h2 class="font-display text-lg font-semibold">Your license</h2>
						{#if license && cardPlan}
							<div class="flex flex-col items-center gap-4">
								<LicenseCard
									variant={cardPlan === 'lifetime' ? 'gold' : 'silver'}
									plan={planNames[cardPlan]}
									holder={data.holderName}
									activeSince={cardPlan === 'lifetime'
										? license.lifetimePurchasedAt
										: (license.subscribedAt ?? license._creationTime)}
								/>
							</div>
						{:else}
							<div class="border-line bg-elevated rounded-xl border p-4">
								{#if !license}
									<p class="text-muted-foreground text-sm text-pretty">
										No license yet. Download the desktop app and sign in to start your free trial.
									</p>
								{:else}
									<div class="flex flex-wrap items-center justify-between gap-3">
										<div>
											<div class="text-lg font-semibold">
												{statusLabel(license.plan, license.status, license.trialEndsAt)}
											</div>
											{#if !waitlistPending && (license.plan === 'trial' || license.plan === 'none')}
												<!-- /pricing, not the homepage anchor: in waitlist mode the homepage
												     pricing section is hidden, so #pricing lands on the home page
												     with nothing to scroll to. /pricing works in both modes.
												     Hidden while waitlist-pending: non-invited accounts cannot buy yet. -->
												<a href="/pricing" class="text-flame text-sm font-semibold">Upgrade</a>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<div id="settings-billing" class="flex flex-col gap-3">
						<h2 class="font-display text-lg font-semibold">Billing</h2>
						<div class="border-line bg-elevated flex flex-col gap-4 rounded-xl border p-4">
							{#if license?.plan === 'lifetime'}
								<div>
									<div class="text-foreground text-base font-semibold">Perpetual license</div>
									<p class="text-muted-foreground mt-1 text-sm text-pretty">
										One-time purchase
										{#if license.lifetimePurchasedAt}
											on {formatDate(license.lifetimePurchasedAt)}
										{/if}. No recurring charges.
									</p>
								</div>
							{:else if subscriptionPlan}
								<div class="flex flex-col gap-1">
									<div class="text-foreground text-base font-semibold">
										{planNames[subscriptionPlan]} subscription
									</div>
									<p class="text-muted-foreground text-sm">
										{license?.status === 'active'
											? 'Active'
											: license?.status === 'suspended'
												? 'Suspended'
												: 'Lapsed'}
										{#if license?.currentPeriodEnd}
											·
											{license.status !== 'active'
												? 'Access until'
												: license.cancelAtPeriodEnd
													? 'Cancels'
													: 'Renews'}
											{formatDate(license.currentPeriodEnd)}
										{/if}
									</p>
								</div>
								{#if canOpenBillingPortal}
									<Button
										variant="outline"
										class="w-fit"
										onclick={manageBilling}
										disabled={openingPortal}
									>
										Manage billing
									</Button>
								{/if}
							{:else}
								<div>
									<div class="text-foreground text-base font-semibold">No subscription</div>
									<p class="text-muted-foreground mt-1 text-sm text-pretty">
										{#if waitlistPending}
											Billing unlocks once you redeem an invite code.
										{:else}
											Subscribe or buy a perpetual license to keep Super Review after your trial.
										{/if}
									</p>
								</div>
								{#if !waitlistPending}
									<a href="/pricing" class="text-flame w-fit text-sm font-semibold">View pricing</a>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			</section>
		</div>
	</div>

	<!-- Mobile bottom menu: collapsed shows the current page; expanded adds search + tabs. -->
	{#if mobileMenuOpen}
		<button
			type="button"
			class="fixed inset-0 z-40 bg-black/50 md:hidden"
			aria-label="Close settings menu"
			transition:fade={{ duration: menuAnimMs }}
			onclick={() => (mobileMenuOpen = false)}
		></button>
	{/if}

	<div
		class="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
	>
		<div class="border-line bg-elevated overflow-hidden rounded-2xl border shadow-2xl">
			{#if mobileMenuOpen}
				<div
					id="mobile-settings-menu"
					class="border-line flex flex-col gap-3 border-b p-3"
					transition:slide={{ duration: menuAnimMs, easing: cubicOut, axis: 'y' }}
				>
					<div class="relative">
						<Search
							class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
						/>
						<Input
							bind:ref={mobileSearchInput}
							bind:value={searchQuery}
							placeholder="Search settings"
							aria-label="Search settings"
							class="border-line bg-base/40 h-11 rounded-xl pr-9 pl-10"
							onkeydown={handleSearchKey}
						/>
						{#if searchQuery}
							<button
								type="button"
								title="Clear search"
								class="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md"
								onclick={() => (searchQuery = '')}
							>
								<X class="size-3.5" />
							</button>
						{/if}
					</div>

					{#if searching}
						{#if searchResults.length === 0}
							<p class="text-muted-foreground px-1 py-2 text-sm">
								No settings match “{trimmedQuery}”.
							</p>
						{:else}
							<div class="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
								{#each searchResults as hit, i (hit.section.id)}
									{@const active = i === highlightedIndex}
									<button
										type="button"
										data-search-result={i}
										class={cn(
											'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm',
											active
												? 'bg-muted text-foreground'
												: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
										)}
										onmousemove={() => (highlightedIndex = i)}
										onclick={() => goToSetting(hit.section)}
									>
										<span class="min-w-0 flex-1 truncate">{hit.section.title}</span>
										<span class="text-muted-foreground shrink-0 text-[10px]">{hit.tabLabel}</span>
									</button>
								{/each}
							</div>
						{/if}
					{:else}
						<nav class="flex flex-col gap-0.5" aria-label="Settings pages">
							{#each TABS as tab (tab.id)}
								{@const Icon = tab.icon}
								<button
									type="button"
									class={cn(
										'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm',
										activeTab === tab.id
											? 'bg-muted text-foreground'
											: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
									)}
									aria-current={activeTab === tab.id ? 'page' : undefined}
									onclick={() => selectTab(tab.id)}
								>
									<Icon class="size-4 shrink-0" />
									<span class="min-w-0 flex-1 truncate">{tab.label}</span>
								</button>
							{/each}
						</nav>
					{/if}
				</div>
			{/if}

			<button
				type="button"
				class="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
				aria-expanded={mobileMenuOpen}
				aria-controls="mobile-settings-menu"
				onclick={() => (mobileMenuOpen ? (mobileMenuOpen = false) : openMobileMenu())}
			>
				<span class="flex min-w-0 items-center gap-2.5 text-sm font-medium">
					{#if activeTabMeta}
						{@const Icon = activeTabMeta.icon}
						<Icon class="size-4 shrink-0" />
						<span class="truncate">{activeTabMeta.label}</span>
					{/if}
				</span>
				<ChevronUp
					class={cn(
						'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
						mobileMenuOpen && 'rotate-180'
					)}
				/>
			</button>
		</div>
	</div>
</div>
