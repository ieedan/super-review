import { UseFrecency } from './hooks/use-frecency.svelte';

// Single shared tracker of repo-id → frecency. Backed by localStorage so the
// RepoSwitcher's order survives restarts.
export const repoFrecency = new UseFrecency('super-local-review.repo-frecency');
