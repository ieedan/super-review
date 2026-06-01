import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	target: 'node20',
	clean: true,
	// `@super-review/core` is a private workspace package published only as TS
	// source, so it must be bundled into the CLI output rather than left as a
	// runtime `import` (node can't load its `.ts` entry). `simple-git` stays
	// external — it's a declared dependency installed from npm.
	noExternal: ['@super-review/core']
});
