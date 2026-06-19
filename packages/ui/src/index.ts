// Public surface of @super-review/ui — the real Super Review app components,
// decoupled from the Electron renderer's store/IPC so any host can mount them.
export { default as AccountSwitcher } from './lib/AccountSwitcher.svelte';
export { default as DiffStylePreview } from './lib/DiffStylePreview.svelte';
export { default as FileListPreview } from './lib/FileListPreview.svelte';
export { default as FileIcon } from './lib/FileIcon.svelte';
export * as Avatar from './lib/ui/avatar';
export * as DropdownMenu from './lib/ui/dropdown-menu';
export { cn, formatRelative } from './lib/utils';

// Diff syntax-highlight themes + shared highlighter (single source of truth).
export {
	DIFF_THEMES,
	DEFAULT_DIFF_THEME,
	diffThemePair,
	resolveDiffThemePreset,
	ALL_DIFF_THEME_NAMES,
	type DiffThemePreset
} from './lib/diff-themes';
export { ensureDiffHighlighter, initDiffHighlighter } from './lib/diff-highlighter';

// package.json hover card: the card component, its shared controller (driven by
// the host's diff token-hover events), and the injectable npm data provider.
export { default as PackageHoverCard } from './lib/PackageHoverCard.svelte';
export {
	packageHover,
	showPackageHover,
	scheduleHidePackageHover,
	keepPackageHover,
	closePackageHover,
	setPackageHoverPinned,
	type PackageHoverTarget,
	type AnchorRect
} from './lib/package-hover.svelte';
export { setNpmProvider, getNpmProvider, type NpmProvider } from './lib/npm-provider';

// Re-export the data types so hosts can type their fixtures/wiring without
// depending on @super-review/core directly.
export type {
	GithubAccount,
	GithubAuthError,
	NpmPackageInfo,
	ReleaseNotes,
	NpmPackageResult,
	ReleaseNotesResult,
	ReleaseNotesRangeResult
} from '@super-review/core/types';
