<script lang="ts">
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { INVITE_CODE_KEY } from '$lib/invite-code';
	import Button from '@super-review/ui/components/button.svelte';

	let signingIn = $state(false);

	/**
	 * Where to land after sign-in. `next` carries the original destination
	 * (including its query string, so an invite link's ?code= survives the round
	 * trip), but it comes from the URL, so it is only trusted as a same-origin
	 * path: one leading slash, and not `//host` or a scheme, either of which
	 * would turn this into an open redirect off the back of our own login page.
	 */
	function safeNext(): string {
		const raw = page.url.searchParams.get('next');
		if (!raw) return '/dashboard';
		if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
		return raw;
	}

	/**
	 * Stash an invite code across the OAuth round trip.
	 *
	 * The code normally rides through in `next`'s query string, but better-auth
	 * does not document preserving a query string on `callbackURL`, and losing it
	 * silently drops someone at an empty form holding a code they were told to
	 * click. sessionStorage is per-tab and same-origin, so it survives the trip to
	 * GitHub and back; the dashboard falls back to it only when the URL has no
	 * code, and clears it once consumed.
	 */
	function stashInviteCode(next: string): void {
		try {
			const code = new URL(next, window.location.origin).searchParams.get('code');
			if (code) sessionStorage.setItem(INVITE_CODE_KEY, code);
		} catch {
			// A malformed `next` just means no code to carry.
		}
	}

	async function signIn(): Promise<void> {
		signingIn = true;
		try {
			const next = safeNext();
			stashInviteCode(next);
			await authClient.signIn.social({ provider: 'github', callbackURL: next });
		} finally {
			signingIn = false;
		}
	}
</script>

<svelte:head><title>Sign in - Super Review</title></svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center px-4">
	<div
		class="border-line bg-elevated flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border p-8 text-center"
	>
		<a href="/" class="flex flex-col items-center gap-3">
			<img src="/icon.png" alt="" class="size-14 rounded-2xl shadow-lg" />
			<span class="sr-only">Super Review</span>
		</a>

		<div class="flex flex-col gap-1.5">
			<h1 class="font-display text-xl font-bold tracking-tight">Sign in to Super Review</h1>
			<p class="text-muted-foreground text-sm text-pretty">
				Sign in with GitHub to manage your license and devices.
			</p>
		</div>

		<Button
			variant="secondary"
			onclick={signIn}
			loading={signingIn}
			class="h-11 w-full gap-2 rounded-xl"
		>
			<svg viewBox="0 0 16 16" class="size-[18px]" fill="currentColor" aria-hidden="true">
				<path
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
				/>
			</svg>
			Continue with GitHub
		</Button>
	</div>
</main>
