export interface RepoInfo {
  id: string;
  path: string;
  name: string;
  iconDataUrl?: string;
  remoteUrl?: string;
  githubOwner?: string;
  githubRepo?: string;
  defaultBranch?: string;
  lastOpenedAt: number;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  isRemote: boolean;
}

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'type-change';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface DiffData {
  file: ChangedFile;
  patch: string;
  oldContents: string;
  newContents: string;
  truncated: boolean;
}

export interface PRSummary {
  number: number;
  title: string;
  body: string;
  author: string;
  authorAvatarUrl: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
  url: string;
  draft: boolean;
  updatedAt: string;
  state: 'open' | 'closed';
}

export type DiffContext =
  | { kind: 'branch'; base: string; head: string }
  | { kind: 'workingTree' }
  | { kind: 'pr'; prNumber: number };

export type ViewMode = 'split' | 'unified';

export interface UserPrefs {
  viewMode: ViewMode;
  theme: 'light' | 'dark' | 'system';
  activeRepoId?: string;
}

export interface DeviceFlowStart {
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
  intervalSec: number;
}

export type DeviceFlowStatus =
  | { state: 'pending' }
  | { state: 'success' }
  | { state: 'error'; message: string };

export interface PreloadAPI {
  repos: {
    list(): Promise<RepoInfo[]>;
    openPicker(): Promise<RepoInfo | null>;
    remove(id: string): Promise<void>;
    setActive(id: string): Promise<RepoInfo | null>;
    getActive(): Promise<RepoInfo | null>;
  };
  git: {
    listBranches(repoId: string): Promise<BranchInfo[]>;
    getCurrentBranch(repoId: string): Promise<string | null>;
    checkout(repoId: string, branch: string): Promise<void>;
    listChangedFiles(repoId: string, ctx: DiffContext): Promise<ChangedFile[]>;
    getDiff(repoId: string, filePath: string, ctx: DiffContext): Promise<DiffData>;
  };
  github: {
    isAuthenticated(): Promise<boolean>;
    startDeviceFlow(): Promise<DeviceFlowStart>;
    pollDeviceFlow(): Promise<DeviceFlowStatus>;
    cancelDeviceFlow(): Promise<void>;
    signOut(): Promise<void>;
    listPRs(repoId: string): Promise<PRSummary[]>;
    fetchPR(repoId: string, prNumber: number): Promise<{ headRef: string; baseRef: string }>;
  };
  state: {
    getPrefs(): Promise<UserPrefs>;
    setPrefs(patch: Partial<UserPrefs>): Promise<UserPrefs>;
    getSeenFiles(repoId: string, contextKey: string): Promise<string[]>;
    setFileSeen(repoId: string, contextKey: string, filePath: string, seen: boolean): Promise<void>;
    clearSeen(repoId: string, contextKey: string): Promise<void>;
  };
  events: {
    onRepoChanged(handler: (repo: RepoInfo | null) => void): () => void;
  };
}

declare global {
  interface Window {
    api: PreloadAPI;
  }
}
