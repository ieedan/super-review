import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
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
		plugins: [externalizeDepsPlugin()],
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
