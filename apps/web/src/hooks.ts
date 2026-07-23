import { initConvex, encodeConvexLoad, decodeConvexLoad } from 'convex-svelte/sveltekit';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Create the Convex client singleton early (server + client) so the transport
// decoder can upgrade SSR-loaded data into a live subscription. setupConvex() in
// the root layout reuses this same singleton.
initConvex(PUBLIC_CONVEX_URL);

// Lets a `convexLoad()` result survive serialization across the SSR boundary and
// be re-hydrated into a live query on the client.
export const transport = {
	ConvexLoadResult: {
		encode: encodeConvexLoad,
		decode: decodeConvexLoad
	}
};
