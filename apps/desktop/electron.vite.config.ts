import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: resolve(__dirname, 'src/main/index.ts')
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
			port: 5173
		}
	}
});
