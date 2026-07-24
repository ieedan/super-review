<script lang="ts">
	import Button from '@super-review/ui/components/button.svelte';

	// Only ever rendered when redemption failed: the success path redirects to the
	// dashboard from the server load.
	let { data } = $props();

	const message = $derived.by(() => {
		switch (data.reason) {
			case 'invalid_code':
				return "That code isn't valid. It may have already been used, or been revoked.";
			case 'too_many_attempts':
				return 'Too many attempts from this account. Wait a little and try the link again.';
			default:
				return 'Something went wrong redeeming your code. Try the link again in a moment.';
		}
	});
</script>

<svelte:head><title>Redeem your invite - Super Review</title></svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center px-4">
	<div
		class="border-line bg-elevated flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border p-8 text-center"
	>
		<a href="/" class="flex flex-col items-center gap-3">
			<img src="/icon.png" alt="" class="size-14 rounded-2xl shadow-lg" />
			<span class="sr-only">Super Review</span>
		</a>

		<div class="flex flex-col gap-1.5">
			<h1 class="font-display text-xl font-bold tracking-tight">Couldn't redeem that code</h1>
			<p class="text-muted-foreground text-sm text-pretty">{message}</p>
		</div>

		<div class="border-line flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5">
			<span class="text-muted-foreground text-xs">Code</span>
			<code class="text-foreground font-mono text-sm tracking-wider">{data.code}</code>
		</div>

		<p class="text-muted-foreground text-xs text-pretty">
			Signed in as <span class="text-fg">{data.email}</span>. If that isn't the account you meant to
			use, sign out and open the link again.
		</p>

		<Button href="/dashboard" class="h-11 w-full rounded-xl">Go to your dashboard</Button>
	</div>
</main>
