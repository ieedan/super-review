import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';

// this proxies the auth routes through sveltekit
// this is important so that you don't need to set your auth callbacks to your convex deployment URL
export const { GET, POST } = createSvelteKitHandler();
