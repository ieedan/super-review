import type { StorybookConfig } from '@storybook/svelte-vite';

// The Svelte plugin, Tailwind, the `@super-review/ui` source alias and the
// worker/dep-optimizer tweaks all live in ./vite.config.ts — Storybook's
// svelte-vite framework consumes the project Vite config, and the CSF addon
// needs the Svelte plugin ahead of it in the plugin order to work.
const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(svelte|ts)'],
	addons: ['@storybook/addon-svelte-csf', '@storybook/addon-docs'],
	framework: {
		name: '@storybook/svelte-vite',
		// Disable the Svelte docgen plugin. It runs svelte2tsx over *every* .svelte
		// file (story files included) to extract prop tables, but it chokes on the
		// addon-svelte-csf story syntax and can't resolve our source-aliased
		// `@super-review/ui` package. We provide argTypes on the stories that need
		// Controls instead, which is all autodocs needs to render.
		options: { docgen: false }
	},
	core: {
		disableTelemetry: true
	}
};

export default config;
