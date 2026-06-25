import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { port: 5173 },
	// Never emit source maps in the production bundle — they'd expose the desktop
	// app's component source (this site imports the real @super-review/ui code).
	build: { sourcemap: false },
	resolve: {
		alias: {
			// Import the Zod 4 SuperForms adapter from its own file, bypassing the
			// `sveltekit-superforms/adapters` barrel. The barrel eagerly evaluates every
			// adapter, and the TypeBox one runs `class extends Type.Base` at module top
			// level — which throws ("Class extends value undefined") whenever TypeBox
			// isn't installed (it's an optional peer dep). zod4.js only needs zod itself.
			'superforms-zod4-adapter': fileURLToPath(
				new URL('./node_modules/sveltekit-superforms/dist/adapters/zod4.js', import.meta.url)
			)
		}
	},
	// FileIcon imports `@iconify/svelte/dist/OfflineIcon.svelte` — a .svelte file
	// behind a `svelte`-only export condition that Vite's dep scanner can't follow.
	// Exclude it from pre-bundling and compile it (and the .svelte sources under the
	// aliased @super-review/ui) on the server so it resolves at request time.
	optimizeDeps: { exclude: ['@iconify/svelte'] },
	ssr: { noExternal: ['@iconify/svelte', '@super-review/ui'] }
});
