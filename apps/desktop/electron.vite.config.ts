import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
	main: {
		// `@super-review/core` is a workspace package shipped as TS source (its
		// `exports` point at `./src/*.ts`), so it must be bundled into the main
		// process rather than left as an external runtime `import` that Node/
		// Electron can't resolve. Every other dependency stays externalized.
		plugins: [externalizeDepsPlugin({ exclude: ['@super-review/core'] })],
		build: {
			rollupOptions: {
				// `index` is the Electron main entry. The super-review CLI used to be a
				// second entry here; it now lives in its own publishable package
				// (`packages/cli`), so the desktop build only emits the main process.
				input: {
					index: resolve(__dirname, 'src/main/index.ts')
				}
			}
		},
		resolve: {
			alias: {
				'@shared': resolve(__dirname, 'src/shared')
			}
		}
	},
	preload: {
		// Bundle `@super-review/core` (TS-source workspace pkg) here too; the
		// preload imports shared types from it via the `@shared` shim.
		plugins: [externalizeDepsPlugin({ exclude: ['@super-review/core'] })],
		build: {
			rollupOptions: {
				input: resolve(__dirname, 'src/preload/index.ts')
			}
		},
		resolve: {
			alias: {
				'@shared': resolve(__dirname, 'src/shared')
			}
		}
	},
	renderer: {
		root: resolve(__dirname, 'src/renderer'),
		plugins: [tailwindcss(), svelte()],
		// Emit Web Workers as ES modules. The @pierre/diffs render worker
		// code-splits (Shiki lazy-loads grammar chunks via dynamic import), which
		// the default `iife` worker format can't do. Electron's Chromium renderer
		// supports module workers, and electron-vite's relative `base` keeps the
		// split chunk URLs resolvable under the packaged `file://` origin.
		worker: {
			format: 'es'
		},
		build: {
			rollupOptions: {
				input: resolve(__dirname, 'src/renderer/index.html')
			}
		},
		resolve: {
			alias: {
				$lib: resolve(__dirname, 'src/renderer/src/lib'),
				'@shared': resolve(__dirname, 'src/shared')
			}
		},
		server: {
			port: 5179
		}
	}
});
