import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Vercel adapter: the marketing pages still prerender to static HTML (see
		// +layout.ts), but the waitlist endpoint (/api/waitlist) needs a serverless
		// function to write to Convex, which adapter-static can't host.
		adapter: adapter(),
		alias: { '@super-review/ui': '../../packages/ui/src' }
	}
};

export default config;
