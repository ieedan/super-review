import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { port: 5173 },
	// @pierre/diffs (used by the embedded DiffStylePreview) renders in a Web
	// Worker that code-splits — Shiki lazy-loads grammar chunks via dynamic
	// import, which the default `iife` worker format can't do. Match the desktop
	// app's renderer config and emit module workers.
	worker: {
		format: 'es'
	}
});
