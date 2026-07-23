import type { SecretClient, SafeConvexClient } from '$lib/convex.svelte';
import type { ConvexHttpClient } from 'convex/browser';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			convex: SafeConvexClient<ConvexHttpClient>;
			convexSecret: SecretClient<ConvexHttpClient>;
			token: string | undefined;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
