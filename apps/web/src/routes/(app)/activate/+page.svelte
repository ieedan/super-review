<script lang="ts">
	import { onMount } from 'svelte';
	import { useConvexClient } from '$lib/convex.svelte';
	import { api } from '$lib/convex/_generated/api';
	import Button from '@super-review/ui/components/button.svelte';
	import { Button as PlainButton } from '@super-review/ui/components/ui/button';
	import * as InputOTP from '@super-review/ui/components/ui/input-otp';
	import { ArrowUpRightIcon } from '@lucide/svelte';

	let { data } = $props();
	const convex = useConvexClient();

	type Step = 'entry' | 'approved';

	let code = $state('');
	let step = $state<Step>('entry');
	let error = $state<string | null>(null);
	let processing = $state(false);

	function normalize(raw: string): string {
		return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
	}

	async function hashUserCode(raw: string): Promise<string> {
		const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalize(raw)));
		return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	async function submitCode(): Promise<void> {
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
		step = 'approved';
	}

	onMount(() => {
		// An optional ?code= prefills the input (the desktop normally opens the
		// page without one, so this is just a convenience).
		const pre = normalize(data.prefill);
		if (pre) code = pre;
		if (pre.length === 8) void submitCode();
	});
</script>

<svelte:head><title>Authorize a device - Super Review</title></svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center px-4">
	<div
		class="border-line bg-elevated flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border p-8 text-center"
	>
		<a href="/" class="flex flex-col items-center gap-3">
			<img src="/icon.png" alt="" class="size-14 rounded-2xl shadow-lg" />
			<span class="sr-only">Super Review</span>
		</a>

		{#if step === 'entry'}
			<div class="flex flex-col gap-1.5">
				<h1 class="font-display text-xl font-bold tracking-tight">Authorize a device</h1>
				<p class="text-muted-foreground text-sm text-pretty">
					Enter the code shown in the Super Review app on the device you want to sign in.
				</p>
			</div>

			<InputOTP.Root
				maxlength={8}
				bind:value={code}
				onComplete={() => void submitCode()}
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

			<Button
				variant="secondary"
				onclick={submitCode}
				loading={processing}
				disabled={normalize(code).length < 8}
				class="h-11 w-full rounded-xl"
			>
				Continue
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
				<ArrowUpRightIcon/>
			</PlainButton>
		{/if}

		{#if error}
			<p class="text-destructive text-xs">{error}</p>
		{/if}
	</div>
</main>
