<script lang="ts">
	import { Button } from './ui/button';
	import { actions, app } from '@super-review/ui/store.svelte';
	import type { LicenseState } from '@super-review/core/types';
	// Imported as a module so Vite emits a hashed URL that resolves under the
	// packaged file:// origin (a bare "./icon.png" does not) and satisfies the
	// renderer CSP (img-src 'self').
	import iconUrl from '../assets/super-review-icon.png';

	// The full-window activation / lock screen shown whenever the app is not
	// licensed. Cosmetic only: the main-process IPC gate is the enforcement.
	// Styled to match the web app's sign-in card.
	const license = $derived(app.license.current);
	const activating = $derived(app.license.activating);
	const error = $derived(app.license.activationError);
	const userCode = $derived(app.license.activationUserCode);
	const verificationUri = $derived(app.license.activationVerificationUri);

	function lockReason(state: LicenseState): string {
		if (state.state !== 'locked') return '';
		switch (state.reason) {
			case 'waitlist':
				return "This account isn't in the beta yet. Redeem your invite code on the website, then recheck.";
			case 'trial_expired':
				return 'Your free trial has ended.';
			case 'subscription_lapsed':
				return 'Your subscription has lapsed.';
			case 'suspended':
				return 'This license has been suspended. Please contact support.';
			case 'offline_expired':
				return 'We could not verify your license. Reconnect to the internet to continue.';
			case 'clock_rollback':
				return 'Your system clock looks wrong. Reconnect to verify your license.';
			case 'fingerprint_mismatch':
				return 'This license is not valid on this machine.';
			case 'revoked':
				return 'This device is no longer authorized. Sign in again to continue.';
		}
	}

	const isPaywall = $derived(
		license?.state === 'locked' &&
			(license.reason === 'trial_expired' || license.reason === 'subscription_lapsed')
	);
	const isSuspended = $derived(license?.state === 'locked' && license.reason === 'suspended');
	// Not a paywall and not an error: there is nothing to buy and nothing to fix,
	// they just aren't in yet. Recheck is the only useful action, and it works the
	// moment the account is accepted (the server starts the trial on validation).
	const isWaitlist = $derived(license?.state === 'locked' && license.reason === 'waitlist');
	const isRetryable = $derived(
		license?.state === 'locked' &&
			(license.reason === 'offline_expired' || license.reason === 'clock_rollback')
	);
</script>

{#snippet githubMark()}
	<svg viewBox="0 0 16 16" class="size-[18px]" fill="currentColor" aria-hidden="true">
		<path
			d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
		/>
	</svg>
{/snippet}

<div class="bg-background flex h-full w-full flex-col">
	<!-- Draggable strip so the frameless window can still be moved. On Windows
	     the AppMenuBar above provides the drag region + window controls. -->
	{#if app.platform !== 'win32'}
		<div class="h-11 shrink-0" style="-webkit-app-region: drag;"></div>
	{/if}

	<div class="flex flex-1 flex-col items-center justify-center px-4 pb-16">
		<div
			class="border-border bg-card flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border p-8 text-center"
		>
			<img src={iconUrl} alt="Super Review" class="size-14 rounded-2xl shadow-lg" />

			<!-- An in-flight activation wins over every license state: "Sign in again"
				can be started from a locked screen too, and the user needs to see the
				code wherever they started from. -->
			{#if activating}
				<div class="flex flex-col gap-1.5">
					<h1 class="text-xl font-semibold tracking-tight">Confirm this device</h1>
					<p class="text-muted-foreground text-sm text-pretty">
						In the browser we opened, confirm this code matches, then approve:
					</p>
				</div>

				{#if userCode}
					<div
						class="border-border bg-background/60 w-full rounded-xl border py-4 font-mono text-2xl font-semibold tracking-[0.3em] tabular-nums"
					>
						{userCode}
					</div>
				{:else}
					<div class="bg-muted h-14 w-full animate-pulse rounded-xl"></div>
				{/if}

				<div class="flex w-full flex-col gap-3">
					{#if verificationUri}
						<Button
							variant="secondary"
							class="h-11 w-full rounded-xl"
							onclick={() => actions.openVerificationPage()}
						>
							Open browser again
						</Button>
					{/if}
					<button
						class="text-muted-foreground hover:text-foreground text-xs underline"
						onclick={() => actions.cancelLicenseActivation()}
					>
						Cancel
					</button>
				</div>
			{:else if !license || license.state === 'unlicensed'}
				<div class="flex flex-col gap-1.5">
					<h1 class="text-xl font-semibold tracking-tight">Sign in to Super Review</h1>
					<p class="text-muted-foreground text-sm text-pretty">
						Sign in with GitHub to start your free 7-day trial.
					</p>
				</div>

				<Button
					variant="secondary"
					class="h-11 w-full gap-2 rounded-xl"
					onclick={() => actions.startLicenseActivation()}
				>
					{@render githubMark()}
					Continue with GitHub
				</Button>
			{:else if license.state === 'activating'}
				<p class="text-muted-foreground text-sm">Activating...</p>
			{:else if license.state === 'locked'}
				<div class="flex flex-col gap-1.5">
					<h1 class="text-xl font-semibold tracking-tight">
						{isSuspended
							? 'License suspended'
							: isPaywall
								? 'Time to upgrade'
								: isWaitlist
									? "You're on the list"
									: 'License check needed'}
					</h1>
					<p class="text-muted-foreground text-sm text-pretty">{lockReason(license)}</p>
				</div>

				<div class="flex w-full flex-col gap-3">
					{#if isPaywall}
						<Button class="h-11 w-full rounded-xl" onclick={() => actions.openPricing()}>
							See plans
						</Button>
						<Button
							variant="outline"
							class="h-11 w-full rounded-xl"
							onclick={() => actions.recheckLicense()}
						>
							I've subscribed - recheck
						</Button>
					{:else if isRetryable}
						<Button class="h-11 w-full rounded-xl" onclick={() => actions.recheckLicense()}>
							Retry
						</Button>
					{:else if isSuspended || isWaitlist}
						<Button
							variant="outline"
							class="h-11 w-full rounded-xl"
							onclick={() => actions.recheckLicense()}
						>
							Recheck
						</Button>
					{:else}
						<Button
							variant="secondary"
							class="h-11 w-full gap-2 rounded-xl"
							onclick={() => actions.startLicenseActivation()}
						>
							{@render githubMark()}
							Sign in again
						</Button>
					{/if}
					<button
						class="text-muted-foreground hover:text-foreground text-xs underline"
						onclick={() => actions.signOutLicense()}
					>
						Sign out
					</button>
				</div>
			{/if}

			{#if error}
				<p class="text-destructive text-xs">{error}</p>
			{/if}
		</div>
	</div>
</div>
