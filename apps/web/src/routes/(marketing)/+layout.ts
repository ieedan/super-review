import { convexLoad } from 'convex-svelte/sveltekit';
import { api } from '$lib/convex/_generated/api';
import type { LayoutLoad } from './$types';

// The landing page now embeds interactive, Convex-backed pricing (set up in the
// root layout), which can't run during build-time prerendering (setupConvex
// opens a WebSocket). Server-render per request instead; it's still fully SSR'd
// for SEO and fast on Vercel. (og.png prerenders on its own, independently.)
export const prerender = false;
export const ssr = true;

// Waitlist mode is loaded on the server so the right hero renders in the HTML
// (no flash of the wrong CTA, and crawlers see it), then transport upgrades it
// to a live subscription. Flipping the flag in the Convex dashboard therefore
// switches open tabs over with no reload and no redeploy.
export const load: LayoutLoad = async () => ({
	settings: await convexLoad(api.settings.getPublic, {})
});
