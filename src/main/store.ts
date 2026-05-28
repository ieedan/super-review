import Store from 'electron-store';
import type { GithubAccount, RepoInfo, UserPrefs } from '@shared/types.js';

export interface StoredGithubAccount extends GithubAccount {
  token: string;
}

interface Schema {
  repos: Record<string, RepoInfo>;
  prefs: UserPrefs;
  // seen[repoId][contextKey] = filePath[]
  seen: Record<string, Record<string, string[]>>;
  // collapsedFiles[repoId][contextKey] = filePath[]
  collapsedFiles: Record<string, Record<string, string[]>>;
  // Multi-account GitHub auth. Keyed by account id (GitHub user id as string).
  githubAccounts: Record<string, StoredGithubAccount>;
  activeGithubAccountId: string | null;
  // Legacy single-token field — migrated lazily, see github-service.
  githubToken: string | null;
}

const defaults: Schema = {
  repos: {},
  prefs: {
    viewMode: 'split',
    theme: 'dark',
    fileListLayout: 'tree',
    showFileIcons: true,
  },
  seen: {},
  collapsedFiles: {},
  githubAccounts: {},
  activeGithubAccountId: null,
  githubToken: null,
};

export const store = new Store<Schema>({ defaults, name: 'super-local-review' });

export function upsertRepo(repo: RepoInfo): void {
  const repos = store.get('repos');
  repos[repo.id] = repo;
  store.set('repos', repos);
}

export function listRepos(): RepoInfo[] {
  return Object.values(store.get('repos')).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function removeRepo(id: string): void {
  const repos = store.get('repos');
  delete repos[id];
  store.set('repos', repos);
  const seen = store.get('seen');
  delete seen[id];
  store.set('seen', seen);
  const collapsed = store.get('collapsedFiles');
  delete collapsed[id];
  store.set('collapsedFiles', collapsed);
  const prefs = store.get('prefs');
  if (prefs.activeRepoId === id) {
    store.set('prefs', { ...prefs, activeRepoId: undefined });
  }
}

export function getRepo(id: string): RepoInfo | null {
  return store.get('repos')[id] ?? null;
}

export function getPrefs(): UserPrefs {
  // Merge with defaults so prefs files saved by older builds still report
  // values for fields added in later releases.
  const merged = { ...defaults.prefs, ...store.get('prefs') };
  // Older builds persisted theme: 'system'; collapse that to the default.
  if ((merged.theme as string) !== 'light' && (merged.theme as string) !== 'dark') {
    merged.theme = defaults.prefs.theme;
  }
  return merged;
}

export function setPrefs(patch: Partial<UserPrefs>): UserPrefs {
  const next = { ...defaults.prefs, ...store.get('prefs'), ...patch };
  store.set('prefs', next);
  return next;
}

export function getSeen(repoId: string, contextKey: string): string[] {
  return store.get('seen')[repoId]?.[contextKey] ?? [];
}

export function setSeen(repoId: string, contextKey: string, filePath: string, seen: boolean): void {
  const all = store.get('seen');
  const forRepo = (all[repoId] ??= {});
  const forCtx = new Set(forRepo[contextKey] ?? []);
  if (seen) forCtx.add(filePath);
  else forCtx.delete(filePath);
  forRepo[contextKey] = [...forCtx];
  store.set('seen', all);
}

export function clearSeen(repoId: string, contextKey: string): void {
  const all = store.get('seen');
  if (all[repoId]) {
    delete all[repoId][contextKey];
    store.set('seen', all);
  }
}

export function getCollapsedFiles(repoId: string, contextKey: string): string[] {
  return store.get('collapsedFiles')[repoId]?.[contextKey] ?? [];
}

export function setFileCollapsed(
  repoId: string,
  contextKey: string,
  filePath: string,
  collapsed: boolean,
): void {
  const all = store.get('collapsedFiles');
  const forRepo = (all[repoId] ??= {});
  const forCtx = new Set(forRepo[contextKey] ?? []);
  if (collapsed) forCtx.add(filePath);
  else forCtx.delete(filePath);
  forRepo[contextKey] = [...forCtx];
  store.set('collapsedFiles', all);
}

export function clearCollapsedFiles(repoId: string, contextKey: string): void {
  const all = store.get('collapsedFiles');
  if (all[repoId]) {
    delete all[repoId][contextKey];
    store.set('collapsedFiles', all);
  }
}

export function getLegacyGithubToken(): string | null {
  return store.get('githubToken');
}

export function clearLegacyGithubToken(): void {
  store.set('githubToken', null);
}

export function listGithubAccounts(): StoredGithubAccount[] {
  return Object.values(store.get('githubAccounts')).sort((a, b) => a.addedAt - b.addedAt);
}

export function getGithubAccount(id: string): StoredGithubAccount | null {
  return store.get('githubAccounts')[id] ?? null;
}

export function getActiveGithubAccountId(): string | null {
  return store.get('activeGithubAccountId');
}

export function getActiveGithubAccount(): StoredGithubAccount | null {
  const id = getActiveGithubAccountId();
  if (!id) return null;
  return getGithubAccount(id);
}

export function setActiveGithubAccountId(id: string | null): void {
  store.set('activeGithubAccountId', id);
}

export function upsertGithubAccount(account: StoredGithubAccount): void {
  const accounts = store.get('githubAccounts');
  accounts[account.id] = account;
  store.set('githubAccounts', accounts);
}

export function removeGithubAccount(id: string): void {
  const accounts = store.get('githubAccounts');
  delete accounts[id];
  store.set('githubAccounts', accounts);
  if (getActiveGithubAccountId() === id) {
    const remaining = Object.keys(accounts);
    setActiveGithubAccountId(remaining[0] ?? null);
  }
}
