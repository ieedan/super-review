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

// Re-export the account types so hosts can type their data without depending on
// @super-review/core directly.
export type { GithubAccount, GithubAuthError } from '@super-review/core/types';
