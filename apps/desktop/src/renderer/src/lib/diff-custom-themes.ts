// Red-green-color-blind diff color accommodations, layered on top of the Pierre
// Shiki themes.
//
// @pierre/diffs derives the *entire* diff red/green treatment — the +/- gutter
// markers, the row tint (a `color-mix` of the base color into the editor
// background) and the word-level emphasis highlight — from just two theme
// `colors` keys: `gitDecoration.addedResourceForeground` (the "green", added
// lines) and `gitDecoration.deletedResourceForeground` (the "red", removed
// lines). Nothing else is read (the `diffEditor.*TextBackground` keys Pierre's
// JSON carries are vestigial VSCode keys @pierre/diffs ignores — see
// getHighlighterThemeStyles / the worker's getThemeVariables). So a high-contrast
// accommodation is just a matter of swapping those two colors.
//
// We register each accommodation as its own Shiki theme that *inherits* from the
// matching Pierre base (pierre-dark / pierre-light) and only replaces the two
// diff colors — keeping byte-identical syntax highlighting. Because @pierre/diffs
// resolves themes on the main thread and ships the resolved object to the
// tokenizer workers (resolveTheme throws in a worker), registering here in the
// renderer is enough; the workers never resolve themes themselves.

import { registerCustomTheme, getResolvedOrResolveTheme } from '@pierre/diffs';
import type { DiffsThemeNames } from '@pierre/diffs';

// The two diff colors a theme variant overrides. `addition` is the "green"
// (added lines), `deletion` the "red" (removed lines).
interface DiffColorPair {
	addition: string;
	deletion: string;
}

// A palette's add/del colors for the app's dark and light modes.
interface DiffPalette {
	dark: DiffColorPair;
	light: DiffColorPair;
}

// Pierre Deuteranopia: a deuteranopia/protanopia-safe palette. Additions go BLUE
// and deletions ORANGE-RED — the canonical color-blind-safe pairing. It separates
// changes along a blue↔orange axis (preserved under red-green CVD) *and* by
// brightness, instead of leaning on the red↔green axis that's hard to see.
const PIERRE_RGCB: DiffPalette = {
	dark: { addition: '#3b9eff', deletion: '#ff7a3d' },
	light: { addition: '#0a6dff', deletion: '#d9531a' }
};

// Pierre High Contrast: keeps red/green semantics but pushes the two far apart in
// both saturation and brightness — a light, vivid green against a deep, saturated
// red — so the rows read differently even when the hue gap is muted.
const PIERRE_HC: DiffPalette = {
	dark: { addition: '#3bed7d', deletion: '#ff2d3e' },
	light: { addition: '#0a9e4f', deletion: '#d80d1f' }
};

// Theme names for the two accommodations.
export const RGCB_DARK: DiffsThemeNames = 'pierre-rgcb-dark';
export const RGCB_LIGHT: DiffsThemeNames = 'pierre-rgcb-light';
export const HC_DARK: DiffsThemeNames = 'pierre-hc-dark';
export const HC_LIGHT: DiffsThemeNames = 'pierre-hc-light';

// Build the Shiki `colors` overrides for one variant. Only the two diff colors
// @pierre/diffs actually reads are touched; everything else inherits from base.
function colorOverrides(pair: DiffColorPair): Record<string, string> {
	return {
		'gitDecoration.addedResourceForeground': pair.addition,
		'gitDecoration.deletedResourceForeground': pair.deletion
	};
}

// Register a theme `name` that inherits from a Pierre `base` but swaps the two
// diff colors. The loader derives from Pierre's already-resolved base (Pierre
// self-registers pierre-* when @pierre/diffs is imported), so syntax tokens are
// untouched. registerCustomTheme just stores the loader — no resolution happens
// until the highlighter/pool first needs the theme.
function registerInheritedTheme(name: string, base: DiffsThemeNames, pair: DiffColorPair): void {
	registerCustomTheme(name, async () => {
		const resolved = await getResolvedOrResolveTheme(base);
		return { ...resolved, name, colors: { ...resolved.colors, ...colorOverrides(pair) } };
	});
}

// Register the two accommodation themes. Called from diff-themes' module load
// (which every diff path imports), so the loaders are in place before any preload
// or worker-pool theme resolution. The guard makes it safe to call more than once.
let builtInsRegistered = false;
export function registerBuiltInDiffThemes(): void {
	if (builtInsRegistered) return;
	builtInsRegistered = true;
	registerInheritedTheme(RGCB_DARK, 'pierre-dark', PIERRE_RGCB.dark);
	registerInheritedTheme(RGCB_LIGHT, 'pierre-light', PIERRE_RGCB.light);
	registerInheritedTheme(HC_DARK, 'pierre-dark', PIERRE_HC.dark);
	registerInheritedTheme(HC_LIGHT, 'pierre-light', PIERRE_HC.light);
}
