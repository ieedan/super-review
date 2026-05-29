import Store from 'electron-store';
import type {
  CommitDraft,
  GithubAccount,
  PRSource,
  RepoInfo,
  UserPrefs,
} from '@shared/types.js';

// Records which PR a locally checked-out branch corresponds to, so the UI can
// show "View PR" (and resolve the right repo) even for cross-repo PRs that a
// head-based API lookup can't find.
export interface PRBranchLink {
  number: number;
  source: PRSource;
}
import { DEFAULT_HIDDEN_DIFF_PATTERNS } from '@shared/diff-defer.js';
import { DEFAULT_HOTKEYS } from '@shared/hotkeys.js';

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
  // Unsent commit message drafts, keyed by repoId.
  commitDrafts: Record<string, CommitDraft>;
  // PR associations for checked-out branches: prBranches[repoId][branch].
  prBranches: Record<string, Record<string, PRBranchLink>>;
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
    unstagedFileListLayout: 'tree',
    branchFileListLayout: 'tree',
    showFileIcons: true,
    openFileOnArrowNav: true,
    codeFont: 'system',
    uiFont: 'system',
    maxDiffLines: 1500,
    hiddenDiffPatterns: DEFAULT_HIDDEN_DIFF_PATTERNS,
    animationsEnabled: false,
    hotkeys: DEFAULT_HOTKEYS,
  },
  seen: {},
  collapsedFiles: {},
  commitDrafts: {},
  prBranches: {},
  githubAccounts: {},
  activeGithubAccountId: null,
  githubToken: null,
};

export const store = new Store<Schema>({ defaults, name: 'super-review' });

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
  const drafts = store.get('commitDrafts');
  delete drafts[id];
  store.set('commitDrafts', drafts);
  const prBranches = store.get('prBranches');
  delete prBranches[id];
  store.set('prBranches', prBranches);
  const prefs = store.get('prefs');
  if (prefs.activeRepoId === id) {
    store.set('prefs', { ...prefs, activeRepoId: undefined });
  }
}

export function getRepo(id: string): RepoInfo | null {
  return store.get('repos')[id] ?? null;
}

// Pin (or unpin, when accountId is null) the GitHub account a project uses.
export function setRepoGithubAccountId(
  repoId: string,
  accountId: string | null,
): RepoInfo | null {
  const repos = store.get('repos');
  const repo = repos[repoId];
  if (!repo) return null;
  const next: RepoInfo = { ...repo };
  if (accountId) next.githubAccountId = accountId;
  else delete next.githubAccountId;
  repos[repoId] = next;
  store.set('repos', repos);
  return next;
}

// Persist (or clear) the fork's upstream/parent repo on a project.
export function setRepoUpstream(
  repoId: string,
  upstream: { owner: string; repo: string } | null,
): RepoInfo | null {
  const repos = store.get('repos');
  const repo = repos[repoId];
  if (!repo) return null;
  const next: RepoInfo = { ...repo };
  if (upstream) {
    next.upstreamOwner = upstream.owner;
    next.upstreamRepo = upstream.repo;
  } else {
    delete next.upstreamOwner;
    delete next.upstreamRepo;
  }
  repos[repoId] = next;
  store.set('repos', repos);
  return next;
}

// Remember (or, when link is null, forget) which PR a checked-out branch maps
// to so the UI can resolve it later regardless of head-based API lookups.
export function setPRBranch(
  repoId: string,
  branch: string,
  link: PRBranchLink | null,
): void {
  const all = store.get('prBranches');
  const forRepo = (all[repoId] ??= {});
  if (link) forRepo[branch] = link;
  else delete forRepo[branch];
  store.set('prBranches', all);
}

export function getPRBranch(
  repoId: string,
  branch: string,
): PRBranchLink | null {
  return store.get('prBranches')[repoId]?.[branch] ?? null;
}

export function getPrefs(): UserPrefs {
  // Merge with defaults so prefs files saved by older builds still report
  // values for fields added in later releases.
  const merged = { ...defaults.prefs, ...store.get('prefs') };
  // Older builds persisted theme: 'system'; collapse that to the default.
  if ((merged.theme as string) !== 'light' && (merged.theme as string) !== 'dark') {
    merged.theme = defaults.prefs.theme;
  }
  // Merge per-action so bindings added in later releases get their defaults
  // even when an older prefs file already has a (partial) hotkeys object.
  merged.hotkeys = { ...defaults.prefs.hotkeys, ...merged.hotkeys };
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

export function getCommitDraft(repoId: string): CommitDraft {
  return store.get('commitDrafts')[repoId] ?? { summary: '', description: '' };
}

export function setCommitDraft(repoId: string, draft: CommitDraft): void {
  const all = store.get('commitDrafts');
  if (!draft.summary && !draft.description) {
    delete all[repoId];
  } else {
    all[repoId] = draft;
  }
  store.set('commitDrafts', all);
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
  // Unpin any project that referenced the removed account so it falls back to
  // the app-wide default.
  const repos = store.get('repos');
  let changed = false;
  for (const repo of Object.values(repos)) {
    if (repo.githubAccountId === id) {
      delete repo.githubAccountId;
      changed = true;
    }
  }
  if (changed) store.set('repos', repos);
}
