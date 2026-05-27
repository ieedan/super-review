import Store from 'electron-store';
import type { RepoInfo, UserPrefs } from '@shared/types.js';

interface Schema {
  repos: Record<string, RepoInfo>;
  prefs: UserPrefs;
  // seen[repoId][contextKey] = filePath[]
  seen: Record<string, Record<string, string[]>>;
  // githubToken stored separately so we can wipe it without nuking everything
  githubToken: string | null;
}

const defaults: Schema = {
  repos: {},
  prefs: {
    viewMode: 'split',
    theme: 'system',
  },
  seen: {},
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
  const prefs = store.get('prefs');
  if (prefs.activeRepoId === id) {
    store.set('prefs', { ...prefs, activeRepoId: undefined });
  }
}

export function getRepo(id: string): RepoInfo | null {
  return store.get('repos')[id] ?? null;
}

export function getPrefs(): UserPrefs {
  return store.get('prefs');
}

export function setPrefs(patch: Partial<UserPrefs>): UserPrefs {
  const next = { ...store.get('prefs'), ...patch };
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

export function getGithubToken(): string | null {
  return store.get('githubToken');
}

export function setGithubToken(token: string | null): void {
  store.set('githubToken', token);
}
