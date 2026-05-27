import type {
  BranchInfo,
  ChangedFile,
  DiffContext,
  PRSummary,
  RepoInfo,
  UserPrefs,
  ViewMode,
} from '@shared/types';
import { diffContextKey } from '@shared/diff-context';

interface AppState {
  repos: RepoInfo[];
  activeRepo: RepoInfo | null;
  branches: BranchInfo[];
  currentBranch: string | null;
  prs: PRSummary[];
  diffContext: DiffContext;
  changedFiles: ChangedFile[];
  selectedFile: string | null;
  seenFiles: Set<string>;
  viewMode: ViewMode;
  prefs: UserPrefs | null;
  githubAuthed: boolean;
  loading: {
    files: boolean;
    branches: boolean;
    prs: boolean;
    repos: boolean;
  };
  error: string | null;
}

const initial: AppState = {
  repos: [],
  activeRepo: null,
  branches: [],
  currentBranch: null,
  prs: [],
  diffContext: { kind: 'workingTree' },
  changedFiles: [],
  selectedFile: null,
  seenFiles: new Set(),
  viewMode: 'split',
  prefs: null,
  githubAuthed: false,
  loading: { files: false, branches: false, prs: false, repos: false },
  error: null,
};

export const app = $state<AppState>(initial);

export function setError(msg: string | null): void {
  app.error = msg;
}

async function refreshRepos(): Promise<void> {
  app.loading.repos = true;
  try {
    app.repos = await window.api.repos.list();
  } finally {
    app.loading.repos = false;
  }
}

async function refreshBranches(): Promise<void> {
  if (!app.activeRepo) return;
  app.loading.branches = true;
  try {
    app.branches = await window.api.git.listBranches(app.activeRepo.id);
    app.currentBranch = await window.api.git.getCurrentBranch(app.activeRepo.id);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    app.loading.branches = false;
  }
}

async function refreshFiles(): Promise<void> {
  if (!app.activeRepo) {
    app.changedFiles = [];
    return;
  }
  app.loading.files = true;
  try {
    app.changedFiles = await window.api.git.listChangedFiles(
      app.activeRepo.id,
      app.diffContext,
    );
    const seenList = await window.api.state.getSeenFiles(
      app.activeRepo.id,
      diffContextKey(app.diffContext),
    );
    app.seenFiles = new Set(seenList);
    const firstUnseen = app.changedFiles.find((f) => !app.seenFiles.has(f.path));
    app.selectedFile = firstUnseen?.path ?? app.changedFiles[0]?.path ?? null;
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    app.changedFiles = [];
    app.selectedFile = null;
  } finally {
    app.loading.files = false;
  }
}

export const actions = {
  async init(): Promise<void> {
    app.prefs = await window.api.state.getPrefs();
    app.viewMode = app.prefs.viewMode;
    app.githubAuthed = await window.api.github.isAuthenticated();
    await refreshRepos();
    app.activeRepo = await window.api.repos.getActive();
    if (app.activeRepo) {
      await Promise.all([refreshBranches(), refreshFiles()]);
    }
  },

  async openRepo(): Promise<void> {
    try {
      const repo = await window.api.repos.openPicker();
      if (repo) {
        app.activeRepo = repo;
        app.diffContext = { kind: 'workingTree' };
        await Promise.all([refreshRepos(), refreshBranches(), refreshFiles()]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  async switchRepo(id: string): Promise<void> {
    const repo = await window.api.repos.setActive(id);
    if (repo) {
      app.activeRepo = repo;
      app.diffContext = { kind: 'workingTree' };
      app.prs = [];
      await Promise.all([refreshRepos(), refreshBranches(), refreshFiles()]);
    }
  },

  async removeRepo(id: string): Promise<void> {
    await window.api.repos.remove(id);
    if (app.activeRepo?.id === id) {
      app.activeRepo = null;
      app.changedFiles = [];
      app.branches = [];
      app.selectedFile = null;
    }
    await refreshRepos();
  },

  async setDiffContext(ctx: DiffContext): Promise<void> {
    app.diffContext = ctx;
    await refreshFiles();
  },

  async selectFile(path: string): Promise<void> {
    app.selectedFile = path;
  },

  async toggleViewMode(): Promise<void> {
    app.viewMode = app.viewMode === 'split' ? 'unified' : 'split';
    app.prefs = await window.api.state.setPrefs({ viewMode: app.viewMode });
  },

  async toggleSeen(filePath: string, seen?: boolean): Promise<void> {
    if (!app.activeRepo) return;
    const next = seen ?? !app.seenFiles.has(filePath);
    if (next) app.seenFiles.add(filePath);
    else app.seenFiles.delete(filePath);
    app.seenFiles = new Set(app.seenFiles);
    await window.api.state.setFileSeen(
      app.activeRepo.id,
      diffContextKey(app.diffContext),
      filePath,
      next,
    );
  },

  async clearSeen(): Promise<void> {
    if (!app.activeRepo) return;
    await window.api.state.clearSeen(app.activeRepo.id, diffContextKey(app.diffContext));
    app.seenFiles = new Set();
  },

  async checkoutBranch(branch: string): Promise<void> {
    if (!app.activeRepo) return;
    try {
      await window.api.git.checkout(app.activeRepo.id, branch);
      await Promise.all([refreshBranches(), refreshFiles()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  async loadPRs(): Promise<void> {
    if (!app.activeRepo) return;
    app.loading.prs = true;
    try {
      app.prs = await window.api.github.listPRs(app.activeRepo.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      app.prs = [];
    } finally {
      app.loading.prs = false;
    }
  },

  async reviewPR(prNumber: number): Promise<void> {
    if (!app.activeRepo) return;
    try {
      await window.api.github.fetchPR(app.activeRepo.id, prNumber);
      await actions.setDiffContext({ kind: 'pr', prNumber });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  async refreshFiles(): Promise<void> {
    await refreshFiles();
  },

  async refreshBranches(): Promise<void> {
    await refreshBranches();
  },

  async signOutGithub(): Promise<void> {
    await window.api.github.signOut();
    app.githubAuthed = false;
    app.prs = [];
  },

  setGithubAuthed(v: boolean): void {
    app.githubAuthed = v;
  },
};
