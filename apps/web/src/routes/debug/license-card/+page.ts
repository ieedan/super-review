import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Visual workbench for the license card variants; dev server only.
export const load: PageLoad = () => {
	if (!dev) throw error(404, 'Not found');
};
