<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '@super-review/ui/components/button.svelte';
	import { Input } from '@super-review/ui/components/ui/input';

	// Dedicated place to type an invite code, linked from the marketing waitlist.
	// Submitting hands off to /join, which signs the user in if needed and redeems
	// server-side. Keeping entry separate from redemption means a wrong account
	// still gets a chance to look before the code is burned.
	let code = $state('');
	let error = $state<string | null>(null);

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		const trimmed = code.trim();
		if (!trimmed) {
			error = 'Enter your invite code.';
			return;
		}
		error = null;
		void goto(`/join?code=${encodeURIComponent(trimmed)}`);
	}
</script>

<svelte:head><title>Enter invite code - Super Review</title></svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center px-4">
	<div
		class="border-line bg-elevated flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border p-8 text-center"
	>
		<a href="/" class="flex flex-col items-center gap-3">
			<img src="/icon.png" alt="" class="size-14 rounded-2xl shadow-lg" />
			<span class="sr-only">Super Review</span>
		</a>

		<div class="flex flex-col gap-1.5">
			<h1 class="font-display text-xl font-bold tracking-tight">Enter your invite code</h1>
			<p class="text-muted-foreground text-sm text-pretty">
				Paste the code from your invite email. We'll sign you in with GitHub and unlock access.
			</p>
		</div>

		<form onsubmit={submit} novalidate class="flex w-full flex-col gap-3">
			<div class="flex flex-col gap-1.5 text-left">
				<Input
					name="invite-code"
					placeholder="SUPER-XXXX-XXXX"
					aria-label="Invite code"
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={error ? 'invite-entry-error' : undefined}
					bind:value={code}
					oninput={() => (error = null)}
					autocapitalize="characters"
					autocomplete="off"
					spellcheck={false}
					class="h-11 w-full rounded-xl font-mono tracking-wider"
				/>
				{#if error}
					<p id="invite-entry-error" class="text-destructive text-sm">{error}</p>
				{/if}
			</div>

			<Button type="submit" class="h-11 w-full rounded-xl" disabled={!code.trim()}>Continue</Button>
		</form>

		<p class="text-muted-foreground text-xs text-pretty">
			Don't have a code yet?
			<a href="/" class="text-fg hover:text-flame underline-offset-2 hover:underline">
				Join the waitlist
			</a>
		</p>
	</div>
</main>
