<script lang="ts">
	import { Spinner } from '@super-review/ui/components/ui/spinner';
	// The server load creates the Stripe session and redirects, so this only
	// shows for the brief moment before that redirect fires.
</script>

<svelte:head><title>Redirecting to checkout - Super Review</title></svelte:head>

<main class="text-muted-foreground flex min-h-screen flex-col items-center justify-center gap-3">
	<Spinner class="size-6" />
	<p class="text-sm">Setting up your checkout...</p>
</main>
