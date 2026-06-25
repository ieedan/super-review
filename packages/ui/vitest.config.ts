import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';

const uiSrc = fileURLToPath(new URL('./src', import.meta.url));

// The components self-import via the package name (`@super-review/ui/...`), which
// only resolves inside the consuming apps (where the package is linked) — not
// here. Alias it to ./src so the real components compile under test.
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: { '@super-review/ui': uiSrc }
	},
	test: {
		projects: [
			{
				// Pure, DOM-free logic — fast, runs in Node (no browser needed).
				extends: true,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.browser.test.ts']
				}
			},
			{
				// Reactivity + real-DOM behaviour — the find controller wired to the
				// real DiffView, Pierre's shadow-DOM render, the IntersectionObserver
				// and CSS Custom Highlights. Must run in a real browser; jsdom has none
				// of those. This is the layer where every recurring find bug lived.
				extends: true,
				test: {
					name: 'browser',
					include: ['src/**/*.browser.test.ts'],
					browser: {
						enabled: true,
						provider: playwright(),
						headless: true,
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
