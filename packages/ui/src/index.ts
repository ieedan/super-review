// Public surface of @super-review/ui — the real Super Review app components,
// decoupled from the Electron renderer's store/IPC so any host can mount them.
export { default as AccountSwitcher } from './lib/AccountSwitcher.svelte';
export * as Avatar from './lib/ui/avatar';
export * as DropdownMenu from './lib/ui/dropdown-menu';
export { cn, formatRelative } from './lib/utils';

// Re-export the account types so hosts can type their data without depending on
// @super-review/core directly.
export type { GithubAccount, GithubAuthError } from '@super-review/core/types';
