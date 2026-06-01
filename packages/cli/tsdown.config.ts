import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/bin.ts'],
	format: ['esm'],
	minify: true,
	deps: {
		// `@super-review/core` is a private workspace package published only as TS
		// source, so it must be bundled into the CLI output rather than left as a
		// runtime `import` (node can't load its `.ts` entry). `simple-git` and
		// `commander` stay external — they're declared dependencies installed from
		// npm.
		alwaysBundle: ['@super-review/core']
	}
});
