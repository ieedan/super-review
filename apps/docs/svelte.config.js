import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		// The /debug/find harness imports the shared UI package by its source.
		// Runtime resolution works via the workspace link, but svelte-check needs
		// the alias to find the type declarations (same mapping the desktop app's
		// tsconfig uses). Adding it here also generates the path into
		// .svelte-kit/tsconfig.json.
		alias: { '@super-review/ui': '../../packages/ui/src' }
	}
};

export default config;
