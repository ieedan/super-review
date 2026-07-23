<script lang="ts">
	import { Button } from '@super-review/ui/components/ui/button';
	import { Input } from '@super-review/ui/components/ui/input';
	import * as Dialog from '@super-review/ui/components/ui/dialog';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import Mail from '@lucide/svelte/icons/mail';
	import Gift from '@lucide/svelte/icons/gift';
	import { page } from '$app/state';
	import { env } from '$lib/env.client';
	import { useConvexClient } from '$lib/convex.svelte';
	import { takeStashedInviteCode } from '$lib/invite-code';
	import { api } from '$lib/convex/_generated/api';
	import { waitlistSchema } from '$lib/schema';

	// Two states in one panel, because they are the same story: not a member yet
	// (redeem a code) or a member (here are yours to share).
	let {
		isMember,
		onWaitlist,
		guestCodes,
		referralReward,
		email,
		// Paid users already have a license, so the referral discount progress is
		// irrelevant; hide the ring + "% off" copy but keep the invite list.
		hasPaidPlan = false
	}: {
		isMember: boolean;
		// Earned once every guest code has been redeemed. `percentOff` comes from
		// the server so this can never advertise a different number than checkout
		// actually applies.
		referralReward: { earnedAt: number | null; percentOff: number };
		// Whether there is a real waitlist row for this account. Drives the copy so
		// the panel never claims a spot that does not exist.
		onWaitlist: boolean;
		guestCodes: Array<{ code: string; redeemed: boolean; sentTo: string | null }>;
		email: string;
		hasPaidPlan?: boolean;
	} = $props();

	const convex = useConvexClient();

	// Prefilled from the invite email's link (/dashboard?code=...), so arriving
	// from the email means one click rather than retyping the code.
	//
	// Deliberately not auto-submitted. Redeeming binds the code permanently to
	// whichever account is signed in and burns it, so on a shared machine or a
	// second GitHub account an auto-redeem would silently spend the invite on the
	// wrong one. The account is shown right above this panel; let them look.
	let code = $state(page.url.searchParams.get('code') ?? '');

	$effect(() => {
		// Fall back to the code the login page stashed before the OAuth round trip,
		// for the case where the query string does not survive `callbackURL`.
		//
		// Always read it, even when the URL already supplied one: takeStashed also
		// clears it, and leaving an unconsumed code behind would prefill a stale
		// one on a later visit in the same tab.
		const stashed = takeStashedInviteCode();
		if (!code && stashed) code = stashed;

		// Drop the code from the address bar once it is in the field: it should not
		// sit in browser history, get copied out of the URL, or ride along in a
		// Referer header to anything the dashboard links out to.
		if (!page.url.searchParams.has('code')) return;
		const url = new URL(window.location.href);
		url.searchParams.delete('code');
		history.replaceState(history.state, '', url.pathname + url.search + url.hash);
	});
	let error = $state<string | null>(null);
	let redeeming = $state(false);
	let copied = $state<string | null>(null);
	// Same brief confirmation as Copied: the Email button flips to "Sent" for a
	// moment after a successful send.
	let sent = $state<string | null>(null);

	// Which unused guest code the "email a friend" dialog is open for. Non-null
	// means the dialog is open.
	let emailingCode = $state<string | null>(null);
	let friendEmail = $state('');
	let emailError = $state<string | null>(null);
	let emailSending = $state(false);

	async function redeem(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (redeeming || !code.trim()) return;

		redeeming = true;
		error = null;
		const res = await convex.safeMutation(api.invites.redeem, { code });
		redeeming = false;

		if (res.isErr()) {
			error =
				res.error.code === 'RATE_LIMITED'
					? 'Too many attempts. Wait a bit and try again.'
					: res.error.code === 'INVALID_INVITE_CODE'
						? "That code isn't valid. Check it and try again."
						: 'Something went wrong. Please try again.';
			return;
		}
		// The live query drives the swap to the member state; nothing to set here.
		code = '';
	}

	let joining = $state(false);
	let joinError = $state<string | null>(null);

	async function joinWaitlist(): Promise<void> {
		if (joining) return;
		joining = true;
		joinError = null;
		const res = await convex.safeMutation(api.waitlist.joinAsCurrentUser, {});
		joining = false;
		// The live query flips this panel to the on-the-list copy; nothing to set.
		if (res.isErr()) joinError = 'Could not join the waitlist. Please try again.';
	}

	async function copy(value: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			copied = value;
			setTimeout(() => (copied === value ? (copied = null) : null), 1500);
		} catch {
			// Clipboard can be blocked; the code is selectable either way.
		}
	}

	function openEmailDialog(guestCode: string): void {
		emailingCode = guestCode;
		friendEmail = '';
		emailError = null;
		emailSending = false;
	}

	function closeEmailDialog(): void {
		emailingCode = null;
		friendEmail = '';
		emailError = null;
		emailSending = false;
	}

	async function sendGuestEmail(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (emailSending || !emailingCode) return;

		const guestCode = emailingCode;
		const parsed = waitlistSchema.safeParse({ email: friendEmail });
		if (!parsed.success) {
			emailError = parsed.error.issues[0]?.message ?? 'Enter a valid email address.';
			return;
		}

		emailSending = true;
		emailError = null;
		const res = await convex.safeMutation(api.invites.emailGuestCode, {
			code: guestCode,
			email: parsed.data.email
		});
		emailSending = false;

		if (res.isErr()) {
			emailError =
				res.error.code === 'RATE_LIMITED'
					? 'Too many emails. Wait a bit and try again.'
					: res.error.code === 'INVALID_EMAIL'
						? 'Enter a valid email address.'
						: res.error.code === 'INVALID_INVITE_CODE'
							? "That code isn't available to send any more."
							: 'Something went wrong. Please try again.';
			return;
		}

		sent = guestCode;
		setTimeout(() => {
			if (sent === guestCode) sent = null;
		}, 3000);
		closeEmailDialog();
	}

	// The lifetime plan is only sold during the launch window, so only mention it
	// while it can actually be bought. Mirrors the same check in Pricing.svelte.
	const launchOpen = Date.now() < Date.parse(env.PUBLIC_LAUNCH_CUTOFF);

	const unusedCount = $derived(guestCodes.filter((c) => !c.redeemed).length);
	const usedCount = $derived(guestCodes.length - unusedCount);
	const earned = $derived(!!referralReward.earnedAt);

	// Drives the ring. Guarded against an empty list so the panel can never divide
	// by zero, though it only renders when there is at least one code.
	const progressPercent = $derived(
		guestCodes.length === 0 ? 0 : Math.round((usedCount / guestCodes.length) * 100)
	);
	const progressLabel = $derived(
		earned
			? `All ${guestCodes.length} invites redeemed, ${referralReward.percentOff}% off unlocked`
			: `${usedCount} of ${guestCodes.length} invites redeemed toward ${referralReward.percentOff}% off`
	);

	// Codes are shown masked (SUPER-••••-••••) so a screenshot or a shoulder over
	// the dashboard does not spend an invite. Copy still puts the real code on the
	// clipboard. Structure-preserving: keep the SUPER prefix, mask the rest.
	//
	// Bullets rather than asterisks: an asterisk sits near the cap line in most
	// fonts, so a row of them reads as a superscript stripe against the centred
	// SUPER- prefix. The bullet is centred on the x-height and lines up.
	function mask(value: string): string {
		const [prefix, ...rest] = value.split('-');
		return [prefix, ...rest.map((part) => '•'.repeat(part.length))].join('-');
	}
</script>

{#if !isMember}
	<section class="border-line bg-elevated flex flex-col gap-3 rounded-xl border px-4 py-5">
		<div class="flex flex-col gap-1.5">
			<h2 class="font-display text-lg font-semibold">
				{onWaitlist ? "You're on the waitlist" : 'Super Review is in a limited beta'}
			</h2>
			<p class="text-muted-foreground text-sm text-pretty">
				{#if onWaitlist}
					We'll email an invite code to <span class="text-fg">{email}</span> when a spot opens up. Got
					one already? Enter it here.
				{:else}
					Join the waitlist and we'll email <span class="text-fg">{email}</span> an invite code when a
					spot opens up.
				{/if}
			</p>
		</div>

		{#if !onWaitlist}
			<!-- Joining is an explicit choice rather than something that happens on
			     page load, so being signed in and not on the list stays a real state. -->
			<div class="flex flex-col gap-1.5">
				<Button onclick={joinWaitlist} class="h-11 w-full rounded-xl sm:w-auto" disabled={joining}>
					{#if joining}
						<LoaderCircle class="size-4 animate-spin" />
					{/if}
					Join the waitlist
				</Button>
				{#if joinError}
					<p class="text-destructive text-sm">{joinError}</p>
				{/if}
			</div>
		{/if}

		{#if !onWaitlist}
			<p class="text-muted-foreground text-sm">Already have an invite code?</p>
		{/if}
		<form onsubmit={redeem} novalidate class="flex flex-col gap-2 sm:flex-row sm:items-start">
			<div class="flex flex-1 flex-col gap-1.5">
				<Input
					name="invite-code"
					placeholder="SUPER-XXXX-XXXX"
					aria-label="Invite code"
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={error ? 'invite-error' : undefined}
					bind:value={code}
					oninput={() => (error = null)}
					autocapitalize="characters"
					autocomplete="off"
					spellcheck={false}
					class="h-11 w-full rounded-xl font-mono tracking-wider"
				/>
				{#if error}
					<p id="invite-error" class="text-destructive text-sm">{error}</p>
				{/if}
			</div>
			<Button type="submit" class="h-11 rounded-xl px-5" disabled={redeeming || !code.trim()}>
				{#if redeeming}
					<LoaderCircle class="size-4 animate-spin" />
				{/if}
				Redeem
			</Button>
		</form>
	</section>
{:else if guestCodes.length > 0}
	<!-- The one place on the dashboard we want people to actually act on, so it
	     carries the brand flame instead of the neutral panel treatment. -->
	<section class="invite-panel relative flex flex-col gap-3 overflow-hidden rounded-xl px-4 py-5">
		<div class="flex flex-col gap-1.5">
			<h2 class="font-display flex items-center gap-2 text-lg font-semibold">
				<Gift class="text-flame size-4.5" />
				Invite your friends
			</h2>
			{#if !hasPaidPlan}
				<div class="flex items-center gap-3">
					<!-- Progress toward the discount. r is 15.9155 so the circumference is
					     exactly 100, which lets stroke-dasharray take the percentage
					     directly. Rotated so it fills from twelve o'clock. -->
					<div class="relative shrink-0">
						<svg
							viewBox="0 0 36 36"
							class="size-9 -rotate-90"
							role="img"
							aria-label={progressLabel}
						>
							<circle
								class="ring-track"
								cx="18"
								cy="18"
								r="15.9155"
								fill="none"
								stroke-width="3.5"
							/>
							{#if progressPercent > 0}
								<!-- Omitted entirely at zero: a round cap on a zero-length dash
								     still paints a dot, which reads as progress that isn't there. -->
								<circle
									class="ring-value"
									cx="18"
									cy="18"
									r="15.9155"
									fill="none"
									stroke-width="3.5"
									stroke-linecap="round"
									stroke-dasharray="{progressPercent} 100"
								/>
							{/if}
						</svg>
						<span
							aria-hidden="true"
							class="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums"
							class:text-flame={earned}
						>
							{usedCount}/{guestCodes.length}
						</span>
					</div>

					<!-- The ring already shows the fraction, so the line says what the
					     reward is rather than repeating the count. The lifetime plan is only
					     mentioned while the launch window is open, since that is the only
					     time it can actually be bought. -->
					<span class="text-muted-foreground text-sm text-pretty">
						{#if earned}
							<span class="text-flame font-medium">{referralReward.percentOff}% off</span> unlocked
						{:else}
							Share your remaining codes to unlock
							<span class="text-flame font-medium">{referralReward.percentOff}% off</span>
							{launchOpen ? 'a subscription or perpetual license' : 'a subscription'}
						{/if}
					</span>
				</div>
			{/if}
		</div>

		<ul class="flex flex-col gap-2">
			{#each guestCodes as guest, i (guest.code)}
				<li
					class="invite-code flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
					class:used={guest.redeemed}
				>
					<code
						class="text-fg font-mono text-sm tracking-wider"
						class:line-through={guest.redeemed}
					>
						{mask(guest.code)}
					</code>
					{#if guest.redeemed}
						<span class="text-muted-foreground text-xs">Used</span>
					{:else}
						<div class="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								class="hover:text-flame"
								onclick={() => openEmailDialog(guest.code)}
								aria-label="Email invite code {i + 1}"
							>
								{#if sent === guest.code}
									<Check class="size-3.5" /> Sent
								{:else}
									<Mail class="size-3.5" /> Email
								{/if}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="hover:text-flame"
								onclick={() => copy(guest.code)}
								aria-label="Copy invite code {i + 1}"
							>
								{#if copied === guest.code}
									<Check class="size-3.5" /> Copied
								{:else}
									<Copy class="size-3.5" /> Copy
								{/if}
							</Button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<Dialog.Root open={emailingCode !== null} onOpenChange={(v) => !v && closeEmailDialog()}>
			<Dialog.Content class="w-[420px] max-w-[92vw]">
				<form onsubmit={sendGuestEmail} novalidate class="flex flex-col gap-4">
					<Dialog.Header>
						<Dialog.Title>Email invite</Dialog.Title>
						<Dialog.Description>Email this invite code to a friend.</Dialog.Description>
					</Dialog.Header>

					<div class="flex flex-col gap-1.5">
						<Input
							type="email"
							name="friend-email"
							autocomplete="email"
							placeholder="friend@email.com"
							aria-label="Friend's email address"
							aria-invalid={emailError ? 'true' : undefined}
							aria-describedby={emailError ? 'email-invite-error' : undefined}
							bind:value={friendEmail}
							oninput={() => (emailError = null)}
							class="h-10 w-full rounded-xl text-sm"
						/>
						{#if emailError}
							<p id="email-invite-error" class="text-destructive text-xs">{emailError}</p>
						{/if}
					</div>

					<Dialog.Footer>
						<Button type="submit" class="rounded-xl" disabled={emailSending || !friendEmail.trim()}>
							{#if emailSending}
								<LoaderCircle class="size-3.5 animate-spin" />
							{/if}
							Send
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	</section>
{/if}

<style>
	/* Flame tint over the elevated surface, plus a soft glow bleeding in from the
	   top-left corner so the panel reads as lit rather than merely coloured. */
	.invite-panel {
		border: 1px solid hsl(11 100% 64% / 0.28);
		background:
			radial-gradient(120% 100% at 0% 0%, hsl(11 100% 60% / 0.1), transparent 60%),
			var(--color-elevated);
		box-shadow: 0 0 24px -12px hsl(11 100% 60% / 0.45);
	}

	/* Unfilled part of the ring: the flame at low opacity rather than the neutral
	   line colour, so the track reads as part of the same dial. */
	.ring-track {
		stroke: hsl(11 100% 64% / 0.18);
	}

	.ring-value {
		stroke: var(--color-flame);
		transition: stroke-dasharray 0.5s ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.ring-value {
			transition: none;
		}
	}

	.invite-code {
		border-color: hsl(11 100% 64% / 0.2);
		background: hsl(11 100% 60% / 0.05);
	}

	/* Spent codes drop back to the neutral panel treatment: they are history, not
	   something to act on. */
	.invite-code.used {
		border-color: var(--color-line);
		background: transparent;
		opacity: 0.5;
	}
	.invite-code.used code {
		color: var(--color-muted-foreground);
	}
</style>
