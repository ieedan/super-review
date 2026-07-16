import { ImageResponse } from '@ethercorps/sveltekit-og';
import { ogImageHtml } from '$lib/og/template';
import { resolveOgFonts } from '$lib/og/fonts';
import type { RequestHandler } from './$types';

// Pre-render at build time so /og.png is a static asset on Vercel.
export const prerender = true;

export const GET: RequestHandler = async () => {
	return new ImageResponse(
		ogImageHtml(),
		{
			width: 1200,
			height: 630,
			fonts: await resolveOgFonts()
		}
	);
};
