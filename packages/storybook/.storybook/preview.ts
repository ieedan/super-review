import type { Preview } from '@storybook/svelte-vite';
import { installApiStub } from './api-stub';
import './preview.css';

// Stand in for the Electron preload bridge before any component mounts.
installApiStub();

// Apply the chosen theme (light/dark) and accent (flame/mono) to the preview
// document root and backdrop. These mirror the classes the real app toggles on
// its root element, so stories react to them exactly as the app does.
function applyTheme(theme: string, accent: string) {
	const root = document.documentElement;
	root.classList.toggle('dark', theme === 'dark');
	root.classList.toggle('accent-mono', accent === 'mono');
}

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i
			}
		},
		// Use our own theme switcher (below) rather than Storybook's white/black
		// canvas backgrounds, so the surface always matches the active palette.
		backgrounds: { disable: true },
		layout: 'centered'
	},
	initialGlobals: {
		theme: 'dark',
		accent: 'flame'
	},
	globalTypes: {
		theme: {
			description: 'Color theme',
			toolbar: {
				title: 'Theme',
				icon: 'mirror',
				items: [
					{ value: 'light', title: 'Light', icon: 'sun' },
					{ value: 'dark', title: 'Dark', icon: 'moon' }
				],
				dynamicTitle: true
			}
		},
		accent: {
			description: 'Accent palette',
			toolbar: {
				title: 'Accent',
				icon: 'paintbrush',
				items: [
					{ value: 'flame', title: 'Flame' },
					{ value: 'mono', title: 'Mono' }
				],
				dynamicTitle: true
			}
		}
	},
	decorators: [
		(story, context) => {
			applyTheme(context.globals.theme ?? 'dark', context.globals.accent ?? 'flame');
			return story();
		}
	]
};

export default preview;
