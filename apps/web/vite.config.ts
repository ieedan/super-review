import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { sveltekitOG } from '@ethercorps/sveltekit-og/plugin';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), sveltekitOG()],
	envPrefix: ['PUBLIC_'],
	server: { port: 5173 },
	// Never emit source maps in the production bundle — they'd expose the desktop
	// app's component source (this site imports the real @super-review/ui code).
	build: { sourcemap: false },
	resolve: {
		// `@super-review/ui`'s FileIcon imports `@iconify/svelte/dist/OfflineIcon.svelte`,
		// exposed only under a `svelte` export condition; on-demand resolution
		// applies the condition via this alias.
		alias: {
			'@iconify/svelte/dist/OfflineIcon.svelte': fileURLToPath(
				new URL('./node_modules/@iconify/svelte/dist/OfflineIcon.svelte', import.meta.url)
			)
		}
	},
	// esbuild/rolldown can't bundle @iconify/svelte's .svelte files, so keep it out
	// of pre-bundling. Auto-discovery is left ON so CJS deps deep in the UI graph
	// get pre-bundled with proper ESM interop (the eager scanner logs a non-fatal
	// resolve error for the iconify subpath, but the module still resolves and
	// optimizes on demand).
	optimizeDeps: { exclude: ['@iconify/svelte'] },
	ssr: { noExternal: ['@iconify/svelte', '@super-review/ui'] }
});
