import type {
  BranchInfo,
  ChangedFile,
  ContextTab,
  DiffContext,
  DiffData,
  EditorKind,
  FileListLayout,
  GithubAccount,
  LastCommit,
  PRReviewComment,
  PRSummary,
  PushStatus,
  RepoInfo,
  TerminalKind,
  UserPrefs,
  ViewMode,
} from "@shared/types";
import { diffContextKey } from "@shared/diff-context";
import { DEFAULT_HIDDEN_DIFF_PATTERNS } from "@shared/diff-defer";
import { comparePathsVSCodeStyle } from "$lib/utils";
import { repoFrecency } from "$lib/repo-frecency.svelte";

// Re-export so existing component imports (`from '$lib/store.svelte'`) keep
// working. The canonical definition lives in @shared/types.
export type { ContextTab };

// Per-file pending composer state — keyed by `${filePath}::${side}::${line}`.
// Used by DiffFileSection to render an inline compose box at the right spot.
export interface PendingComposer {
  filePath: string;
  line: number;
  side: "LEFT" | "RIGHT";
  // Optional comment id we're replying to. When set, posting will use the
  // reply endpoint instead of creating a top-level comment.
  replyTo?: number;
  draft: string;
  submitting: boolean;
}

interface AppState {
  repos: RepoInfo[];
  activeRepo: RepoInfo | null;
  branches: BranchInfo[];
  currentBranch: string | null;
  prs: PRSummary[];
  diffContext: DiffContext;
  contextTab: ContextTab;
  changedFiles: ChangedFile[];
  // Free-text filter applied to the changed-files list. Shared between the
  // sidebar (where it's typed) and the diff view (which hides sections for
  // files that don't match) so both stay in sync.
  fileSearchQuery: string;
  // Count of working-tree changes, kept in sync regardless of the active tab
  // so the Unstaged tab can always show a badge with the current count.
  unstagedFileCount: number;
  selectedFile: string | null;
  seenFiles: Set<string>;
  collapsedFiles: Set<string>;
  viewMode: ViewMode;
  fileListLayout: FileListLayout;
  showFileIcons: boolean;
  maxDiffLines: number;
  hiddenDiffPatterns: string[];
  theme: "light" | "dark";
  prefs: UserPrefs | null;
  githubAccounts: GithubAccount[];
  activeGithubAccount: GithubAccount | null;
  sidebarCollapsed: boolean;
  collapsedFolders: Set<string>;
  scrollRequest: { path: string; nonce: number } | null;
  lastRefreshAt: number | null;
  fetchingOrigin: boolean;
  nowTick: number;
  editors: { cursor: boolean; vscode: boolean };
  terminals: Record<TerminalKind, boolean>;
  settingsDialogOpen: boolean;
  githubSignInOpen: boolean;
  pushStatus: PushStatus | null;
  // Tip commit of the current branch, surfaced so the commit box can offer an
  // "Undo" affordance for the most recent unpushed commit.
  lastCommit: LastCommit | null;
  // PR matching the current branch (if any). Refreshed alongside push status.
  branchPR: PRSummary | null;
  // PR currently being reviewed (when diffContext.kind === 'pr').
  activePR: PRSummary | null;
  // Review comments for the active PR, indexed by file path.
  prComments: Record<string, PRReviewComment[]>;
  loadingComments: boolean;
  // At most one composer can be open per (file,line,side) at a time. Keyed
  // by the same string the renderer uses to scope the annotation.
  pendingComposers: Record<string, PendingComposer>;
  addRepoDialogOpen: boolean;
  createBranchDialogOpen: boolean;
  push: {
    inProgress: boolean;
    stage:
      | "idle"
      | "fetching"
      | "committing"
      | "pulling"
      | "pushing"
      | "conflicts"
      | "done";
    intent: "push" | "pull";
    error: string | null;
  };
  conflictFiles: string[];
  loading: {
    files: boolean;
    branches: boolean;
    prs: boolean;
    repos: boolean;
  };
  error: string | null;
}

export function composerKey(
  filePath: string,
  side: "LEFT" | "RIGHT",
  line: number,
): string {
  return `${filePath}::${side}::${line}`;
}

// Resolve which PR the comment surface should target.
// - `kind: 'pr'` context: the PR being reviewed (its number lives on the ctx).
// - any other context with a known `branchPR`: comment against that PR. The
//   local diff is computed against working-tree / branch refs, so line
//   numbers may not align with what GitHub has — uncommitted changes shift
//   positions, for instance. GitHub will mark the resulting comment outdated
//   in that case, same as commenting from a stale web view.
export function commentablePRNumber(): number | null {
  if (app.diffContext.kind === "pr") return app.diffContext.prNumber;
  if (app.branchPR) return app.branchPR.number;
  return null;
}

const initial: AppState = {
  repos: [],
  activeRepo: null,
  branches: [],
  currentBranch: null,
  prs: [],
  diffContext: { kind: "workingTree" },
  contextTab: "unstaged",
  changedFiles: [],
  fileSearchQuery: "",
  unstagedFileCount: 0,
  selectedFile: null,
  seenFiles: new Set(),
  collapsedFiles: new Set(),
  viewMode: "split",
  fileListLayout: "tree",
  showFileIcons: true,
  maxDiffLines: 1500,
  hiddenDiffPatterns: DEFAULT_HIDDEN_DIFF_PATTERNS,
  theme: "dark",
  prefs: null,
  githubAccounts: [],
  activeGithubAccount: null,
  sidebarCollapsed: false,
  collapsedFolders: new Set(),
  scrollRequest: null,
  lastRefreshAt: null,
  fetchingOrigin: false,
  nowTick: 0,
  editors: { cursor: false, vscode: false },
  terminals: { terminal: false, iterm: false, warp: false, ghostty: false },
  settingsDialogOpen: false,
  githubSignInOpen: false,
  pushStatus: null,
  lastCommit: null,
  branchPR: null,
  activePR: null,
  prComments: {},
  loadingComments: false,
  pendingComposers: {},
  addRepoDialogOpen: false,
  createBranchDialogOpen: false,
  push: { inProgress: false, stage: "idle", intent: "push", error: null },
  conflictFiles: [],
  loading: { files: false, branches: false, prs: false, repos: false },
  error: null,
};

export const app = $state<AppState>(initial);

// Stale-while-revalidate caches keyed by repo + diff context. Switching tabs
// hydrates from these immediately so the file list and diffs feel snappy
// while a background refresh fetches the latest.
interface FilesCacheEntry {
  changedFiles: ChangedFile[];
  seenFiles: Set<string>;
  collapsedFiles: Set<string>;
  selectedFile: string | null;
}
const filesCache = new Map<string, FilesCacheEntry>();
const diffCache = new Map<string, DiffData>();

function filesCacheKey(repoId: string, ctx: DiffContext): string {
  return `${repoId}::${diffContextKey(ctx)}`;
}

function diffCacheKeyFor(
  repoId: string,
  ctx: DiffContext,
  filePath: string,
): string {
  return `${repoId}::${diffContextKey(ctx)}::${filePath}`;
}

export function getCachedDiff(
  repoId: string,
  ctx: DiffContext,
  filePath: string,
): DiffData | undefined {
  return diffCache.get(diffCacheKeyFor(repoId, ctx, filePath));
}

export function setCachedDiff(
  repoId: string,
  ctx: DiffContext,
  filePath: string,
  data: DiffData,
): void {
  diffCache.set(diffCacheKeyFor(repoId, ctx, filePath), data);
}

export function setError(msg: string | null): void {
  app.error = msg;
}

function applyTheme(theme: "light" | "dark"): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

// Editor the user has configured, falling back to whichever is detected.
// Returns null when nothing is available.
export function effectiveEditor(): EditorKind | null {
  const pref = app.prefs?.externalEditor ?? null;
  if (pref && app.editors[pref]) return pref;
  if (app.editors.cursor) return "cursor";
  if (app.editors.vscode) return "vscode";
  return null;
}

// Terminal the user has configured, falling back to whichever is detected.
const TERMINAL_FALLBACK_ORDER: TerminalKind[] = [
  "ghostty",
  "warp",
  "iterm",
  "terminal",
];
export function effectiveTerminal(): TerminalKind | null {
  const pref = app.prefs?.externalTerminal ?? null;
  if (pref && app.terminals[pref]) return pref;
  for (const t of TERMINAL_FALLBACK_ORDER) {
    if (app.terminals[t]) return t;
  }
  return null;
}

async function refreshGithubAccounts(): Promise<void> {
  const [accounts, active] = await Promise.all([
    window.api.github.listAccounts(),
    window.api.github.getActiveAccount(),
  ]);
  app.githubAccounts = accounts;
  app.activeGithubAccount = active;
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
    app.currentBranch = await window.api.git.getCurrentBranch(
      app.activeRepo.id,
    );
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    app.loading.branches = false;
  }
}

async function refreshPushStatus(): Promise<void> {
  if (!app.activeRepo) {
    app.pushStatus = null;
    app.lastCommit = null;
    return;
  }
  const repoId = app.activeRepo.id;
  try {
    const [status, lastCommit] = await Promise.all([
      window.api.git.getPushStatus(repoId),
      window.api.git.getLastCommit(repoId),
    ]);
    app.pushStatus = status;
    app.lastCommit = lastCommit;
  } catch {
    app.pushStatus = null;
    app.lastCommit = null;
  }
}

// Look up the open PR (if any) for the current branch. Only meaningful when
// the repo has a GitHub remote and the user is signed in. Failures are silent
// — the primary action button just falls back to "Create PR".
async function refreshBranchPR(): Promise<void> {
  if (
    !app.activeRepo ||
    !app.activeRepo.githubOwner ||
    !app.activeRepo.githubRepo ||
    !app.activeGithubAccount ||
    !app.currentBranch
  ) {
    app.branchPR = null;
    return;
  }
  const prev = app.branchPR?.number ?? null;
  try {
    app.branchPR = await window.api.github.findPRForBranch(
      app.activeRepo.id,
      app.currentBranch,
    );
  } catch {
    app.branchPR = null;
  }
  // Keep PR-comment state in sync with the branch tab's PR. Only refetch when
  // we're not in `kind: 'pr'` mode (that flow drives its own fetch already).
  if (app.diffContext.kind !== "pr") {
    const next = app.branchPR?.number ?? null;
    if (next == null) {
      app.prComments = {};
      app.pendingComposers = {};
    } else if (next !== prev) {
      void actions.refreshPRComments();
    }
  }
}

// Update the active tab and persist it so the next launch lands on the same
// tab. Fire-and-forget on the persistence side — the UI already reflects the
// change, and prefs writes are cheap.
function applyContextTab(tab: ContextTab): void {
  app.contextTab = tab;
  // The query is scoped to "files on this tab/repo"; carrying it across
  // surfaces a stale filter that hides everything in the new context.
  app.fileSearchQuery = "";
  void window.api.state.setPrefs({ contextTab: tab }).then((prefs) => {
    app.prefs = prefs;
  });
}

// Resolve which DiffContext the current tab should drive.
function contextForTab(tab: ContextTab): DiffContext {
  if (tab === "branch") {
    const base = app.activeRepo?.defaultBranch ?? "main";
    const head = app.currentBranch ?? "HEAD";
    return { kind: "branch", base, head };
  }
  // 'sessions' is a placeholder — treat like workingTree until implemented.
  return { kind: "workingTree" };
}

// Fetch the working-tree file count and store it on `app.unstagedFileCount`
// so the Unstaged tab badge stays accurate even when another tab is active.
// Errors are swallowed — the badge is non-critical and we'd rather keep a
// stale count than throw a banner over a transient git failure.
async function refreshUnstagedCount(): Promise<void> {
  if (!app.activeRepo) {
    app.unstagedFileCount = 0;
    return;
  }
  const repoId = app.activeRepo.id;
  try {
    const files = await window.api.git.listChangedFiles(repoId, {
      kind: "workingTree",
    });
    if (!app.activeRepo || app.activeRepo.id !== repoId) return;
    app.unstagedFileCount = files.length;
  } catch {
    // keep previous count
  }
}

async function refreshFiles(): Promise<void> {
  if (!app.activeRepo) {
    app.changedFiles = [];
    app.unstagedFileCount = 0;
    return;
  }
  const repoId = app.activeRepo.id;
  const ctx = $state.snapshot(app.diffContext) as DiffContext;
  const cacheKey = filesCacheKey(repoId, ctx);
  const hadCache = filesCache.has(cacheKey);

  // Cache miss → show the loading state. Cache hit → silent background refresh
  // (the caller has already hydrated `app.changedFiles` from cache).
  if (!hadCache) {
    app.loading.files = true;
  }
  try {
    // Kick off both IPC calls in parallel — getSeenFiles is just a store
    // read but it still costs a context bridge roundtrip.
    const [raw, seenList, collapsedList] = await Promise.all([
      window.api.git.listChangedFiles(repoId, ctx),
      window.api.state.getSeenFiles(repoId, diffContextKey(ctx)),
      window.api.state.getCollapsedFiles(repoId, diffContextKey(ctx)),
    ]);
    // Sort by path so the diff view and the sidebar tree agree on order —
    // otherwise the "first file in the tree" can land mid-list in the diff
    // view, and scrolling past it jumps to whatever git happened to list
    // before/after instead of feeling like you're at the boundary.
    const files = [...raw].sort((a, b) =>
      comparePathsVSCodeStyle(a.path, b.path),
    );
    // Bail if the user switched tabs / repos while we were fetching.
    if (!app.activeRepo || app.activeRepo.id !== repoId) return;
    const currentCtx = $state.snapshot(app.diffContext) as DiffContext;
    if (filesCacheKey(repoId, currentCtx) !== cacheKey) return;

    const seenSet = new Set(seenList);
    const collapsedSet = new Set(collapsedList);

    const stillSelected =
      app.selectedFile && files.some((f) => f.path === app.selectedFile);
    const firstUnseen = files.find((f) => !seenSet.has(f.path));
    const nextSelected = stillSelected
      ? app.selectedFile
      : (firstUnseen?.path ?? files[0]?.path ?? null);

    app.changedFiles = files;
    app.seenFiles = seenSet;
    app.collapsedFiles = collapsedSet;
    app.selectedFile = nextSelected;

    filesCache.set(cacheKey, {
      changedFiles: files,
      seenFiles: new Set(seenSet),
      collapsedFiles: new Set(collapsedSet),
      selectedFile: nextSelected,
    });

    // Keep the Unstaged tab badge in sync. When the active context already is
    // the working tree, the fetched list IS the unstaged count; otherwise we
    // need a separate fetch since the active tab isn't tracking it.
    if (ctx.kind === "workingTree") {
      app.unstagedFileCount = files.length;
    } else {
      void refreshUnstagedCount();
    }

    app.lastRefreshAt = Date.now();
  } catch (err) {
    // On error, keep showing whatever cache we hydrated from. Only surface
    // the error when we had nothing to show.
    if (!hadCache) {
      setError(err instanceof Error ? err.message : String(err));
      app.changedFiles = [];
      app.selectedFile = null;
    }
  } finally {
    app.loading.files = false;
  }
}

export const actions = {
  async init(): Promise<void> {
    app.prefs = await window.api.state.getPrefs();
    app.viewMode = app.prefs.viewMode;
    app.fileListLayout = app.prefs.fileListLayout;
    app.showFileIcons = app.prefs.showFileIcons;
    app.maxDiffLines = app.prefs.maxDiffLines;
    app.hiddenDiffPatterns = app.prefs.hiddenDiffPatterns;
    app.theme = app.prefs.theme;
    applyTheme(app.theme);
    await refreshGithubAccounts();
    app.editors = await window.api.editor.detect();
    app.terminals = await window.api.terminal.detect();
    await refreshRepos();
    app.activeRepo = await window.api.repos.getActive();
    if (app.activeRepo) {
      repoFrecency.use(app.activeRepo.id);
      // Restore the last tab. The 'branch' tab needs `currentBranch` to build
      // its DiffContext, so refresh branches first when restoring it.
      const savedTab = app.prefs.contextTab;
      if (savedTab === "branch") {
        await refreshBranches();
        app.contextTab = "branch";
        app.diffContext = contextForTab("branch");
        await Promise.all([refreshFiles(), refreshPushStatus()]);
      } else if (savedTab === "sessions") {
        app.contextTab = "sessions";
        // Sessions is a placeholder — no file list to fetch. We still want the
        // Unstaged tab badge to be accurate on launch, so fetch the count.
        await Promise.all([
          refreshBranches(),
          refreshPushStatus(),
          refreshUnstagedCount(),
        ]);
      } else {
        await Promise.all([
          refreshBranches(),
          refreshFiles(),
          refreshPushStatus(),
        ]);
      }
      await refreshBranchPR();
    }
  },

  async openRepo(): Promise<void> {
    try {
      const repo = await window.api.repos.openPicker();
      if (repo) {
        app.activeRepo = repo;
        repoFrecency.use(repo.id);
        applyContextTab("unstaged");
        app.diffContext = { kind: "workingTree" };
        await Promise.all([
          refreshRepos(),
          refreshBranches(),
          refreshFiles(),
          refreshPushStatus(),
        ]);
        await refreshBranchPR();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  async cloneRepo(url: string): Promise<void> {
    try {
      const result = await window.api.git.cloneRepo(url);
      if (!result.ok) {
        if (result.error && result.error !== "Clone cancelled.") {
          setError(result.error);
        }
        return;
      }
      applyContextTab("unstaged");
      app.diffContext = { kind: "workingTree" };
      await refreshRepos();
      app.activeRepo = await window.api.repos.getActive();
      if (app.activeRepo) {
        repoFrecency.use(app.activeRepo.id);
        await Promise.all([
          refreshBranches(),
          refreshFiles(),
          refreshPushStatus(),
        ]);
        await refreshBranchPR();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  updateActiveRepoMetadata(repo: RepoInfo): void {
    if (app.activeRepo?.id !== repo.id) return;
    app.activeRepo = repo;
    app.repos = app.repos.map((r) => (r.id === repo.id ? repo : r));
  },

  async switchRepo(id: string): Promise<void> {
    if (app.activeRepo?.id === id) return;
    const repo = await window.api.repos.setActive(id);
    if (repo) {
      app.activeRepo = repo;
      repoFrecency.use(repo.id);
      applyContextTab("unstaged");
      app.diffContext = { kind: "workingTree" };
      app.prs = [];
      app.branchPR = null;
      await Promise.all([
        refreshRepos(),
        refreshBranches(),
        refreshFiles(),
        refreshPushStatus(),
      ]);
      await refreshBranchPR();
    }
  },

  async removeRepo(id: string): Promise<void> {
    await window.api.repos.remove(id);
    if (app.activeRepo?.id === id) {
      app.activeRepo = null;
      app.changedFiles = [];
      app.unstagedFileCount = 0;
      app.branches = [];
      app.selectedFile = null;
    }
    await refreshRepos();
  },

  async setDiffContext(ctx: DiffContext): Promise<void> {
    app.diffContext = ctx;
    if (ctx.kind !== "pr") {
      app.activePR = null;
      app.prComments = {};
      app.pendingComposers = {};
    }
    await refreshFiles();
  },

  // Switch which tab drives the file list. Recomputes the diff context based
  // on the tab + current branch / default branch. Hydrates the file list from
  // the per-context cache (if any) before kicking off a background refresh,
  // so the switch is instant when you've visited this context before.
  async setContextTab(tab: ContextTab): Promise<void> {
    if (app.contextTab === tab) return;
    applyContextTab(tab);
    if (tab === "sessions") {
      // No sessions yet — clear the file list and skip the IPC roundtrip.
      app.changedFiles = [];
      app.selectedFile = null;
      app.seenFiles = new Set();
      app.collapsedFiles = new Set();
      app.diffContext = { kind: "workingTree" };
      return;
    }
    app.diffContext = contextForTab(tab);
    if (app.activeRepo) {
      const cached = filesCache.get(
        filesCacheKey(
          app.activeRepo.id,
          $state.snapshot(app.diffContext) as DiffContext,
        ),
      );
      if (cached) {
        app.changedFiles = cached.changedFiles;
        app.seenFiles = new Set(cached.seenFiles);
        app.collapsedFiles = new Set(cached.collapsedFiles);
        app.selectedFile = cached.selectedFile;
      }
    }
    // Whenever the current branch has an open PR, keep comments around so
    // they show up on whichever tab the user is on. Only clear when there's
    // no PR for the branch (e.g. after merge / branch swap with no PR).
    if (app.branchPR) {
      void actions.refreshPRComments();
    } else {
      app.prComments = {};
      app.pendingComposers = {};
    }
    await refreshFiles();
  },

  async selectFile(path: string): Promise<void> {
    app.selectedFile = path;
  },

  scrollToFile(path: string): void {
    app.selectedFile = path;
    app.scrollRequest = { path, nonce: (app.scrollRequest?.nonce ?? 0) + 1 };
  },

  toggleSidebar(): void {
    app.sidebarCollapsed = !app.sidebarCollapsed;
  },

  toggleFolder(path: string): void {
    const next = new Set(app.collapsedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    app.collapsedFolders = next;
  },

  async toggleViewMode(): Promise<void> {
    app.viewMode = app.viewMode === "split" ? "unified" : "split";
    app.prefs = await window.api.state.setPrefs({ viewMode: app.viewMode });
  },

  async toggleSeen(filePath: string, seen?: boolean): Promise<void> {
    if (!app.activeRepo) return;
    const next = seen ?? !app.seenFiles.has(filePath);
    if (next) app.seenFiles.add(filePath);
    else app.seenFiles.delete(filePath);
    app.seenFiles = new Set(app.seenFiles);
    const ctx = $state.snapshot(app.diffContext) as DiffContext;
    await window.api.state.setFileSeen(
      app.activeRepo.id,
      diffContextKey(ctx),
      filePath,
      next,
    );
  },

  async clearSeen(): Promise<void> {
    if (!app.activeRepo) return;
    const ctx = $state.snapshot(app.diffContext) as DiffContext;
    await window.api.state.clearSeen(app.activeRepo.id, diffContextKey(ctx));
    app.seenFiles = new Set();
  },

  async toggleFileCollapsed(
    filePath: string,
    collapsed?: boolean,
  ): Promise<void> {
    if (!app.activeRepo) return;
    const next = collapsed ?? !app.collapsedFiles.has(filePath);
    const set = new Set(app.collapsedFiles);
    if (next) set.add(filePath);
    else set.delete(filePath);
    app.collapsedFiles = set;
    const ctx = $state.snapshot(app.diffContext) as DiffContext;
    await window.api.state.setFileCollapsed(
      app.activeRepo.id,
      diffContextKey(ctx),
      filePath,
      next,
    );
  },

  async checkoutBranch(branch: string): Promise<void> {
    if (!app.activeRepo) return;
    try {
      await window.api.git.checkout(app.activeRepo.id, branch);
      // Re-derive the diff context for tabs that depend on currentBranch.
      if (app.contextTab === "branch") {
        app.diffContext = contextForTab("branch");
      }
      await Promise.all([
        refreshBranches(),
        refreshFiles(),
        refreshPushStatus(),
      ]);
      await refreshBranchPR();
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
      // Cache the PR summary so we have headSha for comment posting.
      const summary = app.prs.find((p) => p.number === prNumber) ?? null;
      app.activePR =
        summary ?? (await window.api.github.getPR(app.activeRepo.id, prNumber));
      app.prComments = {};
      app.pendingComposers = {};
      await actions.setDiffContext({ kind: "pr", prNumber });
      void actions.refreshPRComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  async refreshPRComments(): Promise<void> {
    if (!app.activeRepo) return;
    const prNumber = commentablePRNumber();
    if (prNumber == null) return;
    app.loadingComments = true;
    try {
      const comments = await window.api.github.listReviewComments(
        app.activeRepo.id,
        prNumber,
      );
      const byPath: Record<string, PRReviewComment[]> = {};
      for (const c of comments) {
        (byPath[c.path] ??= []).push(c);
      }
      // Sort each thread by createdAt so replies follow their parents.
      for (const list of Object.values(byPath)) {
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      }
      app.prComments = byPath;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      app.loadingComments = false;
    }
  },

  openComposer(
    filePath: string,
    side: "LEFT" | "RIGHT",
    line: number,
    replyTo?: number,
  ): void {
    const key = composerKey(filePath, side, line);
    if (app.pendingComposers[key]) return;
    app.pendingComposers = {
      ...app.pendingComposers,
      [key]: { filePath, line, side, replyTo, draft: "", submitting: false },
    };
  },

  setComposerDraft(key: string, draft: string): void {
    const c = app.pendingComposers[key];
    if (!c) return;
    // Mutate in place. Svelte 5 deep-proxies $state, so consumers that read
    // `.draft` re-run, but consumers that only read structural fields
    // (filePath, line, side, replyTo) — like the `lineAnnotations` derived
    // in DiffFileSection — don't see a change and won't trigger Pierre's
    // expensive `rerender`. Without this, every keystroke tore down the
    // textarea and stole focus.
    c.draft = draft;
  },

  cancelComposer(key: string): void {
    if (!app.pendingComposers[key]) return;
    const { [key]: _removed, ...rest } = app.pendingComposers;
    void _removed;
    app.pendingComposers = rest;
  },

  async submitComposer(key: string): Promise<void> {
    if (!app.activeRepo) return;
    const prNumber = commentablePRNumber();
    if (prNumber == null) return;
    const c = app.pendingComposers[key];
    if (!c || !c.draft.trim() || c.submitting) return;
    // Mutate in place — same rationale as setComposerDraft. Flipping
    // `submitting` shouldn't churn `lineAnnotations` and tear down the form.
    c.submitting = true;
    try {
      const created = c.replyTo
        ? await window.api.github.replyReviewComment(
            app.activeRepo.id,
            prNumber,
            c.replyTo,
            c.draft.trim(),
          )
        : await window.api.github.createReviewComment(app.activeRepo.id, {
            prNumber,
            path: c.filePath,
            line: c.line,
            side: c.side,
            body: c.draft.trim(),
          });
      const existing = app.prComments[c.filePath] ?? [];
      app.prComments = {
        ...app.prComments,
        [c.filePath]: [...existing, created],
      };
      const { [key]: _done, ...rest } = app.pendingComposers;
      void _done;
      app.pendingComposers = rest;
    } catch (err) {
      c.submitting = false;
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  async deleteComment(commentId: number, filePath: string): Promise<void> {
    if (!app.activeRepo) return;
    // Optimistically remove the comment so the UI feels instant — the
    // GitHub round-trip can take 500ms+. Snapshot the previous list so we
    // can restore on failure.
    const prev = app.prComments[filePath] ?? [];
    const next = prev.filter((c) => c.id !== commentId);
    app.prComments = { ...app.prComments, [filePath]: next };
    try {
      await window.api.github.deleteReviewComment(app.activeRepo.id, commentId);
    } catch (err) {
      app.prComments = { ...app.prComments, [filePath]: prev };
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  async refreshFiles(): Promise<void> {
    await refreshFiles();
  },

  async refreshBranches(): Promise<void> {
    await refreshBranches();
  },

  // Refresh both the working-tree file list and branch info. Used by the
  // top-bar refresh button and the window-focus listener.
  async refresh(): Promise<void> {
    if (!app.activeRepo) return;
    await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
    await refreshBranchPR();
  },

  // Fetch origin in the background, then refresh. Reported failures don't
  // block the UI — many repos have no remote, or the user may be offline.
  async fetchAndRefresh(): Promise<void> {
    if (!app.activeRepo || app.fetchingOrigin) return;
    app.fetchingOrigin = true;
    try {
      const result = await window.api.git.fetchOrigin(app.activeRepo.id);
      if (!result.ok && result.error) {
        // Don't show as user-facing error — surface only on explicit failures
        console.warn("fetchOrigin failed:", result.error);
      }
      await Promise.all([
        refreshFiles(),
        refreshBranches(),
        refreshPushStatus(),
      ]);
      await refreshBranchPR();
    } finally {
      app.fetchingOrigin = false;
    }
  },

  openAddRepoDialog(): void {
    app.addRepoDialogOpen = true;
  },
  closeAddRepoDialog(): void {
    app.addRepoDialogOpen = false;
  },

  openCreateBranchDialog(): void {
    app.createBranchDialogOpen = true;
  },
  closeCreateBranchDialog(): void {
    app.createBranchDialogOpen = false;
  },

  // Create a new branch, mirroring GitHub Desktop's flow. `bringChanges`
  // applies only when the working tree is dirty: true → checkout into the
  // new branch (working tree follows); false → create the branch without
  // switching so changes stay on the current branch.
  async createBranch(
    name: string,
    opts: { base?: string; bringChanges: boolean },
  ): Promise<boolean> {
    if (!app.activeRepo) return false;
    try {
      const result = await window.api.git.createBranch(
        app.activeRepo.id,
        name,
        {
          base: opts.base,
          checkout: opts.bringChanges,
        },
      );
      if (!result.ok) {
        setError(result.error ?? "Could not create branch.");
        return false;
      }
      if (app.contextTab === "branch") {
        app.diffContext = contextForTab("branch");
      }
      await Promise.all([
        refreshBranches(),
        refreshFiles(),
        refreshPushStatus(),
      ]);
      await refreshBranchPR();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  },

  async createRepo(): Promise<void> {
    try {
      const repo = await window.api.repos.createPicker();
      if (repo) {
        app.activeRepo = repo;
        repoFrecency.use(repo.id);
        applyContextTab("unstaged");
        app.diffContext = { kind: "workingTree" };
        await Promise.all([
          refreshRepos(),
          refreshBranches(),
          refreshFiles(),
          refreshPushStatus(),
        ]);
        await refreshBranchPR();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  // Stage everything and create a commit. Pushing is a separate, explicit
  // step driven by the header push button.
  async commit(summary: string, description?: string): Promise<boolean> {
    if (!app.activeRepo || app.push.inProgress) return false;
    const repoId = app.activeRepo.id;
    const trimmedSummary = summary.trim();
    if (!trimmedSummary) return false;
    const trimmedDescription = description?.trim() ?? "";
    const message = trimmedDescription
      ? `${trimmedSummary}\n\n${trimmedDescription}`
      : trimmedSummary;
    app.push = {
      inProgress: true,
      stage: "committing",
      intent: "push",
      error: null,
    };
    try {
      const commit = await window.api.git.commitAll(repoId, message);
      if (!commit.ok) throw new Error(commit.error ?? "Commit failed.");
      app.push.stage = "done";
      await Promise.all([
        refreshFiles(),
        refreshBranches(),
        refreshPushStatus(),
      ]);
      await refreshBranchPR();
      return true;
    } catch (err) {
      app.push.error = err instanceof Error ? err.message : String(err);
      setError(app.push.error);
      return false;
    } finally {
      app.push.inProgress = false;
    }
  },

  // Undo the most recent commit, keeping its changes staged in the working
  // tree. Only safe (and offered) while the commit hasn't been pushed.
  async undoLastCommit(): Promise<boolean> {
    if (!app.activeRepo || app.push.inProgress) return false;
    const repoId = app.activeRepo.id;
    app.push = {
      inProgress: true,
      stage: "committing",
      intent: "push",
      error: null,
    };
    try {
      const result = await window.api.git.undoLastCommit(repoId);
      if (!result.ok) throw new Error(result.error ?? "Undo failed.");
      app.push.stage = "done";
      await Promise.all([
        refreshFiles(),
        refreshBranches(),
        refreshPushStatus(),
      ]);
      await refreshBranchPR();
      return true;
    } catch (err) {
      app.push.error = err instanceof Error ? err.message : String(err);
      setError(app.push.error);
      return false;
    } finally {
      app.push.inProgress = false;
    }
  },

  // Open the PR for the current branch (if known) or the GitHub "create PR"
  // page (compare URL). No-op when no GitHub remote.
  async openPRPage(): Promise<void> {
    const repo = app.activeRepo;
    if (!repo?.githubOwner || !repo.githubRepo) return;
    if (app.branchPR?.url) {
      await window.api.shell.openExternal(app.branchPR.url);
      return;
    }
    const base = repo.defaultBranch ?? "main";
    const head = app.currentBranch ?? "";
    if (!head) return;
    const url = `https://github.com/${repo.githubOwner}/${repo.githubRepo}/compare/${encodeURIComponent(
      base,
    )}...${encodeURIComponent(head)}?expand=1`;
    await window.api.shell.openExternal(url);
  },

  // Fetch and pull from origin without pushing. Surfaces any merge conflicts
  // through the same conflict dialog as `push()`.
  async pull(): Promise<void> {
    if (!app.activeRepo || app.push.inProgress) return;
    const repoId = app.activeRepo.id;
    app.push = {
      inProgress: true,
      stage: "fetching",
      intent: "pull",
      error: null,
    };
    app.conflictFiles = [];
    try {
      await window.api.git.fetchOrigin(repoId);
      app.push.stage = "pulling";
      const pullResult = await window.api.git.pull(repoId);
      if (!pullResult.ok) {
        if (pullResult.conflicts.length > 0) {
          app.conflictFiles = pullResult.conflicts;
          app.push.stage = "conflicts";
          return;
        }
        throw new Error(pullResult.error ?? "Pull failed.");
      }
      app.push.stage = "done";
      await Promise.all([
        refreshFiles(),
        refreshBranches(),
        refreshPushStatus(),
      ]);
      await refreshBranchPR();
    } catch (err) {
      app.push.error = err instanceof Error ? err.message : String(err);
      setError(app.push.error);
    } finally {
      if (app.push.stage !== "conflicts") {
        app.push.inProgress = false;
      }
    }
  },

  // GitHub Desktop-style push: fetch, pull if behind (surfacing any merge
  // conflicts for the user to reconcile), then push.
  async push(): Promise<void> {
    if (!app.activeRepo || app.push.inProgress) return;
    const repoId = app.activeRepo.id;
    app.push = {
      inProgress: true,
      stage: "fetching",
      intent: "push",
      error: null,
    };
    app.conflictFiles = [];
    try {
      await window.api.git.fetchOrigin(repoId);
      await refreshPushStatus();
      if (app.pushStatus?.behind && app.pushStatus.behind > 0) {
        app.push.stage = "pulling";
        const pullResult = await window.api.git.pull(repoId);
        if (!pullResult.ok) {
          if (pullResult.conflicts.length > 0) {
            app.conflictFiles = pullResult.conflicts;
            app.push.stage = "conflicts";
            // Don't clear inProgress — UI shows the conflict dialog until
            // the user resolves or aborts.
            return;
          }
          throw new Error(pullResult.error ?? "Pull failed.");
        }
      }
      app.push.stage = "pushing";
      const pushResult = await window.api.git.push(repoId);
      if (!pushResult.ok) throw new Error(pushResult.error ?? "Push failed.");
      app.push.stage = "done";
      await Promise.all([
        refreshFiles(),
        refreshBranches(),
        refreshPushStatus(),
      ]);
      await refreshBranchPR();
    } catch (err) {
      app.push.error = err instanceof Error ? err.message : String(err);
      setError(app.push.error);
    } finally {
      // Only release the lock if we're not currently waiting on conflicts.
      if (app.push.stage !== "conflicts") {
        app.push.inProgress = false;
      }
    }
  },

  async resolveConflict(filePath: string): Promise<void> {
    if (!app.activeRepo) return;
    try {
      await window.api.git.stageFile(app.activeRepo.id, filePath);
      const remaining = await window.api.git.getConflicts(app.activeRepo.id);
      app.conflictFiles = remaining;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  // Called from the conflict dialog after the user resolves every file.
  // Finishes the merge commit, then continues the push that triggered it.
  async continueMerge(): Promise<void> {
    if (!app.activeRepo) return;
    const repoId = app.activeRepo.id;
    try {
      const merge = await window.api.git.continueMerge(repoId);
      if (!merge.ok) {
        if (merge.conflicts.length > 0) {
          app.conflictFiles = merge.conflicts;
          return;
        }
        throw new Error(merge.error ?? "Could not continue merge.");
      }
      app.conflictFiles = [];
      // For a pull-only flow, the merge commit is all we needed — skip push.
      if (app.push.intent === "pull") {
        app.push.stage = "done";
        await Promise.all([
          refreshFiles(),
          refreshBranches(),
          refreshPushStatus(),
        ]);
        await refreshBranchPR();
        return;
      }
      // Resume the push pipeline.
      app.push.stage = "pushing";
      const pushResult = await window.api.git.push(repoId);
      if (!pushResult.ok) throw new Error(pushResult.error ?? "Push failed.");
      app.push.stage = "done";
      await Promise.all([
        refreshFiles(),
        refreshBranches(),
        refreshPushStatus(),
      ]);
    } catch (err) {
      app.push.error = err instanceof Error ? err.message : String(err);
      setError(app.push.error);
    } finally {
      app.push.inProgress = false;
    }
  },

  async abortMerge(): Promise<void> {
    if (!app.activeRepo) return;
    try {
      await window.api.git.abortMerge(app.activeRepo.id);
      app.conflictFiles = [];
      app.push = {
        inProgress: false,
        stage: "idle",
        intent: "push",
        error: null,
      };
      await Promise.all([
        refreshFiles(),
        refreshBranches(),
        refreshPushStatus(),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  async setExternalEditor(editor: EditorKind | null): Promise<void> {
    app.prefs = await window.api.state.setPrefs({ externalEditor: editor });
  },

  async openInEditor(target?: string): Promise<void> {
    if (!app.activeRepo) return;
    const editor = effectiveEditor();
    if (!editor) {
      setError(
        "No external editor is configured. Install the cursor or code CLI.",
      );
      return;
    }
    const path = target ?? app.activeRepo.path;
    const resolved =
      target && !target.startsWith("/")
        ? `${app.activeRepo.path}/${target}`
        : path;
    const result = await window.api.editor.open(editor, resolved);
    if (!result.ok && result.error) setError(result.error);
  },

  async setExternalTerminal(terminal: TerminalKind | null): Promise<void> {
    app.prefs = await window.api.state.setPrefs({ externalTerminal: terminal });
  },

  async openInTerminal(target?: string): Promise<void> {
    if (!app.activeRepo) return;
    const terminal = effectiveTerminal();
    if (!terminal) {
      setError("No terminal is configured.");
      return;
    }
    const path = target ?? app.activeRepo.path;
    const resolved =
      target && !target.startsWith("/")
        ? `${app.activeRepo.path}/${target}`
        : path;
    const result = await window.api.terminal.open(terminal, resolved);
    if (!result.ok && result.error) setError(result.error);
  },

  async setViewMode(mode: ViewMode): Promise<void> {
    app.viewMode = mode;
    app.prefs = await window.api.state.setPrefs({ viewMode: mode });
  },

  async setFileListLayout(layout: FileListLayout): Promise<void> {
    app.fileListLayout = layout;
    app.prefs = await window.api.state.setPrefs({ fileListLayout: layout });
  },

  async setShowFileIcons(show: boolean): Promise<void> {
    app.showFileIcons = show;
    app.prefs = await window.api.state.setPrefs({ showFileIcons: show });
  },

  async setMaxDiffLines(max: number): Promise<void> {
    const next = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 0;
    app.maxDiffLines = next;
    app.prefs = await window.api.state.setPrefs({ maxDiffLines: next });
  },

  async setHiddenDiffPatterns(patterns: string[]): Promise<void> {
    // Normalize: trim, drop blanks, de-dupe (preserving order).
    const next = [...new Set(patterns.map((p) => p.trim()).filter(Boolean))];
    app.hiddenDiffPatterns = next;
    app.prefs = await window.api.state.setPrefs({ hiddenDiffPatterns: next });
  },

  async setTheme(theme: "light" | "dark"): Promise<void> {
    app.theme = theme;
    applyTheme(theme);
    app.prefs = await window.api.state.setPrefs({ theme });
  },

  openSettingsDialog(): void {
    app.settingsDialogOpen = true;
  },
  closeSettingsDialog(): void {
    app.settingsDialogOpen = false;
  },

  openGithubSignIn(): void {
    app.githubSignInOpen = true;
  },
  closeGithubSignIn(): void {
    app.githubSignInOpen = false;
  },

  tickNow(): void {
    app.nowTick++;
  },

  async refreshGithubAccounts(): Promise<void> {
    await refreshGithubAccounts();
  },

  async switchGithubAccount(id: string): Promise<void> {
    const next = await window.api.github.setActiveAccount(id);
    if (!next) return;
    app.activeGithubAccount = next;
    app.prs = [];
    if (app.activeRepo?.githubOwner && app.activeRepo.githubRepo) {
      void actions.loadPRs();
    }
  },

  async removeGithubAccount(id: string): Promise<void> {
    await window.api.github.removeAccount(id);
    await refreshGithubAccounts();
    app.prs = [];
    if (
      app.activeGithubAccount &&
      app.activeRepo?.githubOwner &&
      app.activeRepo.githubRepo
    ) {
      void actions.loadPRs();
    }
  },
};
