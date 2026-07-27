<script lang="ts">
	import { useConvexClient } from '$lib/convex.svelte';
	import { api } from '$lib/convex/_generated/api';
	import Button from '@super-review/ui/components/button.svelte';
	import { Button as PlainButton } from '@super-review/ui/components/ui/button';
	import * as InputOTP from '@super-review/ui/components/ui/input-otp';
	import { ArrowUpRightIcon } from '@lucide/svelte';

	let { data } = $props();
	const convex = useConvexClient();

	function normalize(raw: string): string {
		return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
	}

	// The code from the URL (?code=) is the primary path; typedCode backs the OTP
	// fallback when someone lands here without one. `code` is whichever applies.
	const urlCode = $derived(normalize(data.prefill));
	let typedCode = $state('');
	const code = $derived(urlCode || normalize(typedCode));

	// 'confirm' shows the code for a visual match against the device (Confirm/Deny);
	// 'entry' is the manual-typing fallback. Once the user acts, `outcome` pins the
	// terminal screen.
	let outcome = $state<'approved' | 'denied' | null>(null);
	const step = $derived(outcome ?? (urlCode ? 'confirm' : 'entry'));
	let error = $state<string | null>(null);
	let processing = $state(false);

	// Group the 8 characters as XXXX-XXXX to match the code shown on the device.
	const formattedCode = $derived(
		code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4, 8)}` : code
	);

	async function hashUserCode(raw: string): Promise<string> {
		const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalize(raw)));
		return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	// Confirm: validate the code then approve it. Only ever runs from an explicit
	// button press, never automatically on load.
	async function confirm(): Promise<void> {
		if (normalize(code).length < 8 || processing) return;
		processing = true;
		error = null;

		const userCodeHash = await hashUserCode(code);
		const inspectRes = await convex.safeMutation(api.activation.inspect, { userCodeHash });
		if (inspectRes.isErr()) {
			processing = false;
			error =
				inspectRes.error.code === 'RATE_LIMITED'
					? 'Too many attempts. Wait a bit and try again.'
					: 'Something went wrong. Try again.';
			return;
		}
		if (!inspectRes.value.valid) {
			processing = false;
			error = 'That code is invalid or expired. Check the code shown in the app.';
			return;
		}

		if (!inspectRes.value.alreadyApproved) {
			const approveRes = await convex.safeMutation(api.activation.approve, { userCodeHash });
			if (approveRes.isErr()) {
				processing = false;
				error =
					approveRes.error.code === 'INVALID_ACTIVATION_CODE'
						? 'That code just expired. Start again from the app.'
						: 'Something went wrong. Try again.';
				return;
			}
		}

		processing = false;
		outcome = 'approved';
	}

	// Deny: reject the pending code so the device stops waiting.
	async function deny(): Promise<void> {
		if (normalize(code).length < 8 || processing) return;
		processing = true;
		error = null;

		const userCodeHash = await hashUserCode(code);
		const denyRes = await convex.safeMutation(api.activation.deny, { userCodeHash });
		processing = false;
		if (denyRes.isErr()) {
			error = 'Something went wrong. Try again.';
			return;
		}
		outcome = 'denied';
	}
</script>

<svelte:head><title>Device activation - Super Review</title></svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center px-4">
	<a href="/" class="mb-8 flex flex-col items-center gap-3">
		<img src="/icon.png" alt="" class="size-14 rounded-2xl shadow-lg" />
		<span class="font-display text-xl font-bold tracking-tight">Device activation</span>
	</a>

	<div
		class="border-line bg-elevated flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border p-8 text-center"
	>
		{#if step === 'confirm'}
			<p class="text-muted-foreground text-sm text-pretty">
				Confirm this code is shown on your device
			</p>

			<div class="font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums">
				{formattedCode}
			</div>

			{#if data.willStartTrial}
				<p class="text-muted-foreground text-xs text-pretty">
					Confirming starts your <span class="text-fg font-medium">7-day free trial</span>. No card
					required.
				</p>
			{/if}

			<div class="flex w-full gap-3">
				<PlainButton
					variant="outline"
					onclick={deny}
					disabled={processing}
					class="h-11 flex-1 rounded-xl"
				>
					Deny
				</PlainButton>
				<Button onclick={confirm} loading={processing} class="h-11 flex-1 rounded-xl">
					Confirm
				</Button>
			</div>

			<p class="text-muted-foreground text-xs text-pretty">
				Only confirm if you just started activation on your own computer.
			</p>
		{:else if step === 'entry'}
			<div class="flex flex-col gap-1.5">
				<h1 class="font-display text-xl font-bold tracking-tight">Enter your code</h1>
				<p class="text-muted-foreground text-sm text-pretty">
					Enter the code shown in the Super Review app on the device you want to sign in.
				</p>
			</div>

			<InputOTP.Root
				maxlength={8}
				bind:value={typedCode}
				pasteTransformer={(t) => t.replace(/[^a-zA-Z0-9]/g, '')}
				disabled={processing}
				class="justify-center"
			>
				{#snippet children({ cells })}
					<InputOTP.Group>
						{#each cells.slice(0, 4) as cell, i (i)}
							<InputOTP.Slot {cell} />
						{/each}
					</InputOTP.Group>
					<InputOTP.Separator />
					<InputOTP.Group>
						{#each cells.slice(4, 8) as cell, i (i)}
							<InputOTP.Slot {cell} />
						{/each}
					</InputOTP.Group>
				{/snippet}
			</InputOTP.Root>

			{#if data.willStartTrial}
				<p class="text-muted-foreground text-xs text-pretty">
					Authorizing this device starts your
					<span class="text-fg font-medium">7-day free trial</span>. No card required.
				</p>
			{/if}

			<Button
				onclick={confirm}
				loading={processing}
				disabled={normalize(code).length < 8}
				class="h-11 w-full rounded-xl"
			>
				{data.willStartTrial ? 'Start free trial' : 'Authorize device'}
			</Button>
		{:else if step === 'approved'}
			<div class="flex flex-col gap-1.5">
				<h1 class="font-display text-xl font-bold tracking-tight">You're all set</h1>
				<p class="text-muted-foreground text-sm text-pretty">
					Return to Super Review. It will finish signing in automatically.
				</p>
			</div>
			<PlainButton
				variant="outline"
				href="/dashboard"
				class="text-muted-foreground h-9 rounded-lg text-xs"
			>
				Go to Dashboard
				<ArrowUpRightIcon />
			</PlainButton>
		{:else if step === 'denied'}
			<div class="flex flex-col gap-1.5">
				<h1 class="font-display text-xl font-bold tracking-tight">Activation denied</h1>
				<p class="text-muted-foreground text-sm text-pretty">
					That device was not signed in. You can close this tab.
				</p>
			</div>
		{/if}

		{#if error}
			<p class="text-destructive text-xs">{error}</p>
		{/if}
	</div>
</main>
