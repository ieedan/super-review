import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Enable runes mode for our own sources (stories + the @super-review/ui
// components, which are all runes), but NOT globally: the addon-svelte-csf ships
// legacy `.svelte` runtime components in node_modules that still use
// `export let`, and a global `runes: true` makes the compiler reject them.
export default {
	preprocess: vitePreprocess(),
	vitePlugin: {
		dynamicCompileOptions({ filename }) {
			if (!filename.includes('node_modules')) {
				return { runes: true };
			}
		}
	}
};
