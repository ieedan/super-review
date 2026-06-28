import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Storybook's @storybook/svelte-vite framework does NOT add vite-plugin-svelte
// itself — it consumes the project's own Vite config. So the Svelte plugin lives
// here, ahead of the addon-svelte-csf transform in the plugin order, which is
// what lets the CSF addon post-process already-compiled story modules instead of
// choking on raw .svelte source.
const uiSrc = fileURLToPath(new URL('./.storybook/../../ui/src', import.meta.url));

export default defineConfig({
	plugins: [svelte(), tailwindcss()],
	resolve: {
		alias: {
			// The @super-review/ui components self-import via the package specifier
			// (`@super-review/ui/utils.js`), whose exports map points at `./src/*.js`
			// while the real files are `.ts`/`.svelte`. Alias straight at the source
			// and let Vite's extension resolution find them — same as the apps do.
			'@super-review/ui': uiSrc
		}
	},
	optimizeDeps: {
		// FileIcon imports `@iconify/svelte/dist/OfflineIcon.svelte` (a .svelte file
		// behind a `svelte`-only export condition the dep scanner can't follow), so
		// exclude it and the source workspace packages from prebundling.
		exclude: ['@iconify/svelte', '@super-review/ui', '@super-review/core']
	},
	// @pierre/diffs renders in a code-splitting Web Worker (Shiki lazy-loads
	// grammar chunks via dynamic import), which needs the ES module worker format.
	worker: {
		format: 'es'
	}
});
