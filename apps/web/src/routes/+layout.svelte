<script lang="ts">
	import './layout.css';
	import { setupConvex } from '$lib/convex.svelte';
	import { env } from '$lib/env.client';
	import {
		createSvelteAuthClient,
		type AuthClient
	} from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { setAnimations } from '@super-review/ui/hooks/use-animations.svelte';

	let { children, data } = $props();

	// The desktop app lets people pick a mode in settings; the site has no such
	// control, so turn everything on (accents + dialog/menu enter-exit). Without
	// this, shared UI components fall back to `none` and open instantly.
	setAnimations(() => 'all');

	// Set up site-wide (not just the (app) group) so the prerendered marketing
	// homepage's pricing section can trigger checkout / sign-in too.
	// getServerState hands the SSR auth state to setupAuth so hydration sets
	// client auth synchronously; see +layout.server.ts.
	createSvelteAuthClient({
		authClient: authClient as unknown as AuthClient,
		getServerState: () => data.authState
	});
	setupConvex(env.PUBLIC_CONVEX_URL);
</script>

{@render children()}
