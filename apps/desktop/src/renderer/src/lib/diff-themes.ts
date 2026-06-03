// Curated set of syntax-highlighting themes for diff code blocks.
//
// @pierre/diffs tokenizes a diff against a `{ dark, light }` theme pair and then
// flips between the two purely in CSS via `themeType` (see DiffFileSection's
// `setThemeType`). So a "diff theme" the user picks is really a *pair*: a dark
// variant shown while the app is in dark mode and a light variant shown in light
// mode. Each preset below bundles both so switching the app's light/dark theme
// keeps working no matter which diff theme is selected.
//
// The pref persists only the preset `id` (see UserPrefs.diffTheme); the
// dark/light theme names live here in the renderer because they're @pierre/diffs
// (Shiki) identifiers the main process never needs to know about.

import type { DiffsThemeNames, ThemesType } from '@pierre/diffs';

export interface DiffThemePreset {
	id: string;
	label: string;
	// Theme used while the app is in dark mode.
	dark: DiffsThemeNames;
	// Theme used while the app is in light mode.
	light: DiffsThemeNames;
}

// 'pierre' mirrors @pierre/diffs' DEFAULT_THEMES and is the out-of-the-box look,
// so it stays first/default. The rest are popular Shiki bundled themes that ship
// coherent dark *and* light variants.
export const DIFF_THEMES: DiffThemePreset[] = [
	{ id: 'pierre', label: 'Pierre', dark: 'pierre-dark', light: 'pierre-light' },
	{ id: 'pierre-soft', label: 'Pierre Soft', dark: 'pierre-dark-soft', light: 'pierre-light-soft' },
	{ id: 'github', label: 'GitHub', dark: 'github-dark-default', light: 'github-light-default' },
	{ id: 'one', label: 'One', dark: 'one-dark-pro', light: 'one-light' },
	{ id: 'vitesse', label: 'Vitesse', dark: 'vitesse-dark', light: 'vitesse-light' },
	{
		id: 'material',
		label: 'Material',
		dark: 'material-theme-ocean',
		light: 'material-theme-lighter'
	},
	{ id: 'catppuccin', label: 'Catppuccin', dark: 'catppuccin-mocha', light: 'catppuccin-latte' },
	{ id: 'gruvbox', label: 'Gruvbox', dark: 'gruvbox-dark-medium', light: 'gruvbox-light-medium' },
	{ id: 'solarized', label: 'Solarized', dark: 'solarized-dark', light: 'solarized-light' }
];

export const DEFAULT_DIFF_THEME = 'pierre';

const PRESETS_BY_ID = new Map(DIFF_THEMES.map((t) => [t.id, t]));

// Pre-built, memoized `{ dark, light }` pairs keyed by preset id. Stable object
// identity matters: the diff previews key a Svelte `$effect` on the pair, so a
// fresh object each call would rebuild the preview on every reactive tick.
const PAIRS_BY_ID = new Map<string, ThemesType>(
	DIFF_THEMES.map((t) => [t.id, { dark: t.dark, light: t.light }])
);

// Resolve a stored preset id to its preset, falling back to the default for
// unknown ids (e.g. a pref written by a newer build, or a removed preset).
export function resolveDiffThemePreset(id: string | null | undefined): DiffThemePreset {
	return (id != null && PRESETS_BY_ID.get(id)) || PRESETS_BY_ID.get(DEFAULT_DIFF_THEME)!;
}

// The `{ dark, light }` pair to hand @pierre/diffs as its `theme` option. Returns
// the same object instance for a given id across calls.
export function diffThemePair(id: string | null | undefined): ThemesType {
	return (id != null && PAIRS_BY_ID.get(id)) || PAIRS_BY_ID.get(DEFAULT_DIFF_THEME)!;
}

// Every theme name across all presets (dark + light), de-duplicated. Used to
// warm the shared highlighter so previews and live diffs highlight instantly
// instead of flashing plain text while a theme loads on demand.
export const ALL_DIFF_THEME_NAMES: DiffsThemeNames[] = [
	...new Set(DIFF_THEMES.flatMap((t) => [t.dark, t.light]))
];
