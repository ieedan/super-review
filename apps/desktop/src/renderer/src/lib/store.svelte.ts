import type {
  AppPlatform,
  BranchInfo,
  ChangedFile,
  ContextTab,
  DiffContext,
  DiffData,
  EditorKind,
  FileListLayout,
  GithubAccount,
  LastCommit,
  PRChecksSummary,
  PRReviewComment,
  PRSource,
  PRSummary,
  PushStatus,
  RepoInfo,
  TerminalKind,
  UserPrefs,
  ViewMode,
} from "@shared/types";
import { diffContextKey } from "@shared/diff-context";
import { DEFAULT_HIDDEN_DIFF_PATTERNS } from "@shared/diff-defer";
import { DEFAULT_HOTKEYS, type Hotkeys } from "@shared/hotkeys";
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
  // Whether more PR pages remain to be fetched (drives the infinite scroll in
  // the branch picker's Pull Requests tab).
  prsHasMore: boolean;
  // True while a follow-up page of PRs is being appended.
  loadingMorePRs: boolean;
  // Which repo the PR list targets: the repo's own remote ("fork") or, when the
  // active repo is a fork, its parent ("upstream").
  prsSource: PRSource;
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
  // Working-tree files explicitly unchecked in the Unstaged tab so they're
  // left out of the next commit. Tracking exclusions (rather than inclusions)
  // means everything is committed by default and newly-changed files show up
  // checked — matching GitHub Desktop. Only meaningful for the working tree.
  excludedFromCommit: Set<string>;
  collapsedFiles: Set<string>;
  viewMode: ViewMode;
  // File list layout per sidebar tab. The active tab decides which one the
  // sidebar's tree/list toggle reads and writes.
  unstagedFileListLayout: FileListLayout;
  branchFileListLayout: FileListLayout;
  showFileIcons: boolean;
  openFileOnArrowNav: boolean;
  maxDiffLines: number;
  hiddenDiffPatterns: string[];
  animationsEnabled: boolean;
  hotkeys: Hotkeys;
  theme: "light" | "dark";
  codeFont: string;
  uiFont: string;
  // Font families installed on the user's machine, queried lazily on launch.
  // Empty when the Local Font Access API is unavailable or denied.
  systemFonts: string[];
  prefs: UserPrefs | null;
  githubAccounts: GithubAccount[];
  activeGithubAccount: GithubAccount | null;
  sidebarCollapsed: boolean;
  collapsedFolders: Set<string>;
  scrollRequest: { path: string; nonce: number } | null;
  lastRefreshAt: number | null;
  fetchingOrigin: boolean;
  nowTick: number;
  platform: AppPlatform;
  editors: Record<EditorKind, boolean>;
  terminals: Record<TerminalKind, boolean>;
  settingsDialogOpen: boolean;
  // Cmd/Ctrl+K fuzzy file-search palette. Opened from the header search box or
  // the global shortcut; selecting a file scrolls the diff to it.
  commandMenuOpen: boolean;
  githubSignInOpen: boolean;
  pushStatus: PushStatus | null;
  // Tip commit of the current branch, surfaced so the commit box can offer an
  // "Undo" affordance for the most recent unpushed commit.
  lastCommit: LastCommit | null;
  // PR matching the current branch (if any). Refreshed alongside push status.
  branchPR: PRSummary | null;
  // CI/workflow status for `branchPR`'s head commit — aggregate plus the
  // individual checks for a hover breakdown. Keyed by PR number so a stale poll
  // result can't paint the wrong PR. Polled on an interval while a PR is shown.
  branchPRChecks: { number: number; summary: PRChecksSummary } | null;
  // Whether the active account can push commits to `branchPR`'s head branch.
  // null while unknown / not applicable; drives the commit-box warning so it
  // only fires when a push would actually be rejected.
  branchPRPushAccess: boolean | null;
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

// The PR the comment/checks surface currently targets (the one being reviewed,
// or the current branch's PR).
function commentablePR(): PRSummary | null {
  if (app.diffContext.kind === "pr") return app.activePR;
  return app.branchPR;
}

// Host repo (owner, repo) a PR's operations must target — its base repo, which
// for an upstream PR is the parent, not the active fork. Returned as a tuple to
// spread into the host-aware github IPC calls; undefineds fall back server-side
// to the active repo's own coordinates.
function prHostArgs(
  pr: PRSummary | null,
): [owner: string | undefined, repo: string | undefined] {
  return [pr?.repoOwner, pr?.repoName];
}

const initial: AppState = {
  repos: [],
  activeRepo: null,
  branches: [],
  currentBranch: null,
  prs: [],
  prsHasMore: false,
  loadingMorePRs: false,
  prsSource: "fork",
  diffContext: { kind: "workingTree" },
  contextTab: "unstaged",
  changedFiles: [],
  fileSearchQuery: "",
  unstagedFileCount: 0,
  selectedFile: null,
  seenFiles: new Set(),
  excludedFromCommit: new Set(),
  collapsedFiles: new Set(),
  viewMode: "split",
  unstagedFileListLayout: "tree",
  branchFileListLayout: "tree",
  showFileIcons: true,
  openFileOnArrowNav: true,
  maxDiffLines: 1500,
  hiddenDiffPatterns: DEFAULT_HIDDEN_DIFF_PATTERNS,
  animationsEnabled: false,
  hotkeys: DEFAULT_HOTKEYS,
  theme: "dark",
  codeFont: "system",
  uiFont: "system",
  systemFonts: [],
  prefs: null,
  githubAccounts: [],
  activeGithubAccount: null,
  sidebarCollapsed: false,
  collapsedFolders: new Set(),
  scrollRequest: null,
  lastRefreshAt: null,
  fetchingOrigin: false,
  nowTick: 0,
  platform: "darwin",
  editors: {
    cursor: false,
    vscode: false,
    zed: false,
    xcode: false,
    visualstudio: false,
  },
  terminals: {
    terminal: false,
    iterm: false,
    warp: false,
    ghostty: false,
    cmd: false,
    powershell: false,
  },
  settingsDialogOpen: false,
  commandMenuOpen: false,
  githubSignInOpen: false,
  pushStatus: null,
  lastCommit: null,
  branchPR: null,
  branchPRChecks: null,
  branchPRPushAccess: null,
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

// Must match the per-page size the main process requests; a short page tells us
// we've reached the end and there's nothing more to load.
const PR_PAGE_SIZE = 30;
// Last PR page successfully loaded for the active repo (0 = none yet).
let prsPage = 0;
// Repos whose upstream we've already resolved this session, so we only hit the
// GitHub API once per repo to detect a fork's parent.
const upstreamChecked = new Set<string>();
// A user's explicit PR-source choice per repo, remembered for the session so it
// survives reopening the picker. Absent → use the repo's default source.
const prsSourceByRepo = new Map<string, PRSource>();

// The source the PR list defaults to: a fork's upstream when one is known,
// otherwise the repo's own remote.
function defaultPRSource(repo: RepoInfo | null): PRSource {
  return repo?.upstreamOwner && repo.upstreamRepo ? "upstream" : "fork";
}

// Resolve (once per repo) whether the active repo is a fork and, if so, its
// upstream — then settle `app.prsSource` to the user's remembered choice or the
// repo's default. Safe to call before every PR load; the API hit is cached.
async function detectUpstream(): Promise<void> {
  const repo = app.activeRepo;
  if (!repo || !repo.githubOwner || !repo.githubRepo) return;
  if (!upstreamChecked.has(repo.id)) {
    upstreamChecked.add(repo.id);
    try {
      const updated = await window.api.github.detectUpstream(repo.id);
      if (updated && app.activeRepo?.id === updated.id) {
        app.activeRepo = updated;
        const idx = app.repos.findIndex((r) => r.id === updated.id);
        if (idx !== -1) app.repos[idx] = updated;
      }
    } catch {
      // Detection is best-effort — fall back to the fork's own PRs.
    }
  }
  if (app.activeRepo) {
    app.prsSource =
      prsSourceByRepo.get(app.activeRepo.id) ?? defaultPRSource(app.activeRepo);
  }
}

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

// Built-in fallback stacks — kept in sync with the defaults in app.css. A
// chosen family is layered on top so missing glyphs still fall back sensibly.
const UI_FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const CODE_FONT_STACK =
  "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace";

export function uiFontCss(font: string | null | undefined): string {
  if (!font || font === "system") return UI_FONT_STACK;
  return `"${font}", ${UI_FONT_STACK}`;
}

export function codeFontCss(font: string | null | undefined): string {
  if (!font || font === "system") return CODE_FONT_STACK;
  return `"${font}", ${CODE_FONT_STACK}`;
}

function applyFonts(): void {
  const root = document.documentElement;
  root.style.setProperty("--ui-font", uiFontCss(app.uiFont));
  root.style.setProperty("--code-font", codeFontCss(app.codeFont));
}

// Enumerate installed font families via the Local Font Access API. Resolves to
// nothing when the API is missing (older runtime) or the permission is denied;
// the picker then just offers the system default.
async function loadSystemFonts(): Promise<void> {
  const query = (
    window as unknown as {
      queryLocalFonts?: () => Promise<Array<{ family: string }>>;
    }
  ).queryLocalFonts;
  if (typeof query !== "function") return;
  try {
    const fonts = await query();
    const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) =>
      a.localeCompare(b),
    );
    app.systemFonts = families;
  } catch {
    // Unsupported or permission denied — leave the list empty.
  }
}

// Human-readable names for each editor, shown in menus ("Open in <editor>").
export const EDITOR_LABELS: Record<EditorKind, string> = {
  cursor: "Cursor",
  vscode: "Visual Studio Code",
  zed: "Zed",
  xcode: "Xcode",
  visualstudio: "Visual Studio",
};

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
  "powershell",
  "cmd",
];
export function effectiveTerminal(): TerminalKind | null {
  const pref = app.prefs?.externalTerminal ?? null;
  if (pref && app.terminals[pref]) return pref;
  for (const t of TERMINAL_FALLBACK_ORDER) {
    if (app.terminals[t]) return t;
  }
  return null;
}

// The GitHub account the active project authenticates as: its pinned account
// when set, otherwise the app-wide default. Both account switchers and all
// project-scoped GitHub calls resolve through this.
export function effectiveGithubAccount(): GithubAccount | null {
  const pinnedId = app.activeRepo?.githubAccountId;
  if (pinnedId) {
    const pinned = app.githubAccounts.find((a) => a.id === pinnedId);
    if (pinned) return pinned;
  }
  return app.activeGithubAccount;
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
    console.log("[branchPR] skipped — missing prerequisite:", {
      hasActiveRepo: !!app.activeRepo,
      githubOwner: app.activeRepo?.githubOwner ?? null,
      githubRepo: app.activeRepo?.githubRepo ?? null,
      pinnedAccountId: app.activeRepo?.githubAccountId ?? null,
      activeGithubAccount: app.activeGithubAccount?.login ?? null,
      currentBranch: app.currentBranch ?? null,
    });
    app.branchPR = null;
    app.branchPRPushAccess = null;
    return;
  }
  console.log(
    `[branchPR] checking ${app.activeRepo.githubOwner}/${app.activeRepo.githubRepo} ` +
      `branch=${app.currentBranch} ` +
      `pinnedAccountId=${app.activeRepo.githubAccountId ?? "(none → app default)"} ` +
      `appDefault=${app.activeGithubAccount.login}`,
  );
  const prev = app.branchPR?.number ?? null;
  try {
    app.branchPR = await window.api.github.findPRForBranch(
      app.activeRepo.id,
      app.currentBranch,
    );
    console.log(
      `[branchPR] result: ${app.branchPR ? `PR #${app.branchPR.number}` : "none (will show Create PR)"}`,
    );
  } catch (err) {
    console.error("[branchPR] lookup threw:", err);
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
  // Drop any status for a PR we're no longer showing, then refresh.
  if (
    app.branchPRChecks &&
    app.branchPRChecks.number !== app.branchPR?.number
  ) {
    app.branchPRChecks = null;
  }
  await refreshBranchPRChecks();
  void refreshBranchPRPushAccess();
}

// Poll the CI/workflow status for the current branch PR's head commit. Cheap
// and failure-silent — the button just hides the status indicator on error or
// when nothing reports. Called after `refreshBranchPR` and on a timer.
async function refreshBranchPRChecks(): Promise<void> {
  const pr = app.branchPR;
  if (!app.activeRepo || !pr) {
    app.branchPRChecks = null;
    return;
  }
  try {
    const summary = await window.api.github.getChecks(
      app.activeRepo.id,
      pr.headSha,
      ...prHostArgs(pr),
    );
    // The PR may have changed while the request was in flight; only apply the
    // result if it still matches what we're showing.
    if (app.branchPR?.number === pr.number) {
      app.branchPRChecks = { number: pr.number, summary };
    }
  } catch (err) {
    console.error("[branchPR] checks lookup threw:", err);
  }
}

// Push-access answers are stable for a session, so cache per repo+PR to avoid
// re-hitting the API on every branch-PR refresh.
const prPushAccess = new Map<string, boolean>();

// Determine whether the active account can push commits to the current branch
// PR's head branch, so the commit box can warn only when a push would actually
// be rejected. Failure-silent — leaves the answer unknown (null) on error.
async function refreshBranchPRPushAccess(): Promise<void> {
  const pr = app.branchPR;
  if (!app.activeRepo || !pr) {
    app.branchPRPushAccess = null;
    return;
  }
  const key = `${app.activeRepo.id}::${pr.number}`;
  const cached = prPushAccess.get(key);
  if (cached !== undefined) {
    app.branchPRPushAccess = cached;
    return;
  }
  app.branchPRPushAccess = null;
  try {
    const can = await window.api.github.canPushToPR(
      app.activeRepo.id,
      $state.snapshot(pr),
    );
    prPushAccess.set(key, can);
    if (app.branchPR?.number === pr.number) app.branchPRPushAccess = can;
  } catch {
    // Leave unknown — better no warning than a wrong one.
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

    // Drop commit-exclusions for files that are no longer in the working tree
    // (committed, discarded, or reverted) so the "select all" state stays
    // accurate. Only prune against the working-tree list — the branch/PR
    // contexts list different files and would wrongly clear the selection.
    if (ctx.kind === "workingTree" && app.excludedFromCommit.size > 0) {
      const present = new Set(files.map((f) => f.path));
      const pruned = new Set(
        [...app.excludedFromCommit].filter((p) => present.has(p)),
      );
      if (pruned.size !== app.excludedFromCommit.size) {
        app.excludedFromCommit = pruned;
      }
    }

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
    app.unstagedFileListLayout = app.prefs.unstagedFileListLayout;
    app.branchFileListLayout = app.prefs.branchFileListLayout;
    app.showFileIcons = app.prefs.showFileIcons;
    app.openFileOnArrowNav = app.prefs.openFileOnArrowNav;
    app.maxDiffLines = app.prefs.maxDiffLines;
    app.hiddenDiffPatterns = app.prefs.hiddenDiffPatterns;
    app.animationsEnabled = app.prefs.animationsEnabled ?? false;
    app.hotkeys = { ...DEFAULT_HOTKEYS, ...app.prefs.hotkeys };
    app.theme = app.prefs.theme;
    applyTheme(app.theme);
    app.codeFont = app.prefs.codeFont;
    app.uiFont = app.prefs.uiFont;
    applyFonts();
    void loadSystemFonts();
    await refreshGithubAccounts();
    app.platform = window.api.platform;
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

  async openFolder(): Promise<void> {
    try {
      const repos = await window.api.repos.openFolder();
      if (repos.length === 0) return; // Picker cancelled.
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
    const prev = app.activeRepo;
    app.activeRepo = repo;
    app.repos = app.repos.map((r) => (r.id === repo.id ? repo : r));
    // A background refresh may have just resolved the GitHub remote (or the
    // pinned account changed), which makes a branch-PR lookup possible where it
    // wasn't before. Re-check when that identity shifts.
    const identityChanged =
      prev.githubOwner !== repo.githubOwner ||
      prev.githubRepo !== repo.githubRepo ||
      prev.githubAccountId !== repo.githubAccountId;
    if (identityChanged) void refreshBranchPR();
  },

  async switchRepo(id: string): Promise<void> {
    if (app.activeRepo?.id === id) return;
    const repo = await window.api.repos.setActive(id);
    if (repo) {
      app.activeRepo = repo;
      repoFrecency.use(repo.id);
      applyContextTab("unstaged");
      app.diffContext = { kind: "workingTree" };
      app.excludedFromCommit = new Set();
      app.prs = [];
      app.prsHasMore = false;
      prsPage = 0;
      app.prsSource = prsSourceByRepo.get(repo.id) ?? defaultPRSource(repo);
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

  // Toggle whether a working-tree file is included in the next commit. Kept in
  // memory only — the selection resets when the repo changes or a file leaves
  // the working tree (see refreshFiles / switchRepo).
  toggleFileIncludedForCommit(filePath: string, included?: boolean): void {
    const isIncluded = included ?? app.excludedFromCommit.has(filePath);
    const next = new Set(app.excludedFromCommit);
    if (isIncluded) next.delete(filePath);
    else next.add(filePath);
    app.excludedFromCommit = next;
  },

  // The header "select all" checkbox. Clearing the exclusion set includes
  // everything; excluding every current file unchecks the lot.
  setAllIncludedForCommit(included: boolean): void {
    app.excludedFromCommit = included
      ? new Set()
      : new Set(app.changedFiles.map((f) => f.path));
  },

  // Include/exclude a whole set of files at once — backs the folder checkboxes
  // in tree view, which check/uncheck every file beneath them.
  setFilesIncludedForCommit(paths: string[], included: boolean): void {
    const next = new Set(app.excludedFromCommit);
    for (const p of paths) {
      if (included) next.delete(p);
      else next.add(p);
    }
    app.excludedFromCommit = next;
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

  async checkoutBranch(branch: string): Promise<boolean> {
    if (!app.activeRepo) return false;
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  },

  // Load (or reload) the first page of PRs, replacing whatever was there.
  async loadPRs(): Promise<void> {
    if (!app.activeRepo) return;
    // Resolve the fork's upstream (if any) and settle the source before the
    // first fetch so we hit the right repo and the picker can offer the switch.
    await detectUpstream();
    if (!app.activeRepo) return;
    const repoId = app.activeRepo.id;
    const source = app.prsSource;
    prsPage = 0;
    app.loading.prs = true;
    try {
      const page = await window.api.github.listPRs(repoId, 1, source);
      if (app.activeRepo?.id !== repoId || app.prsSource !== source) return;
      app.prs = page;
      prsPage = 1;
      app.prsHasMore = page.length >= PR_PAGE_SIZE;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      app.prs = [];
      app.prsHasMore = false;
    } finally {
      app.loading.prs = false;
    }
  },

  // Fetch the next page of PRs and append it. Called as the PR list scrolls
  // near its end. Guards against overlapping / redundant loads so the infinite
  // scroll can fire it freely.
  async loadMorePRs(): Promise<void> {
    if (
      !app.activeRepo ||
      app.loading.prs ||
      app.loadingMorePRs ||
      !app.prsHasMore
    ) {
      return;
    }
    const repoId = app.activeRepo.id;
    const source = app.prsSource;
    const next = prsPage + 1;
    app.loadingMorePRs = true;
    try {
      const page = await window.api.github.listPRs(repoId, next, source);
      if (app.activeRepo?.id !== repoId || app.prsSource !== source) return;
      const seen = new Set(app.prs.map((p) => p.number));
      app.prs = [...app.prs, ...page.filter((p) => !seen.has(p.number))];
      prsPage = next;
      app.prsHasMore = page.length >= PR_PAGE_SIZE;
    } catch {
      // Stop paging on error rather than spinning on the same failed page.
      app.prsHasMore = false;
    } finally {
      app.loadingMorePRs = false;
    }
  },

  // Check out the head branch of a PR and land on the Branch tab so its diff
  // (head vs. the repo's default branch) is shown for review. Fetches from the
  // upstream when the PR list is currently showing the fork's parent.
  async checkoutPR(pr: PRSummary): Promise<void> {
    if (!app.activeRepo) return;
    try {
      // `pr` is a $state proxy; snapshot to a plain object so it survives the
      // structured-clone across the IPC boundary ("object could not be cloned").
      await window.api.git.checkoutPR(
        app.activeRepo.id,
        $state.snapshot(pr),
        app.prsSource,
      );
      applyContextTab("branch");
      await refreshBranches();
      app.diffContext = contextForTab("branch");
      await Promise.all([refreshFiles(), refreshPushStatus()]);
      await refreshBranchPR();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  // Switch the PR list between the fork and its upstream, remembering the
  // choice for this repo and reloading from page one.
  async setPRSource(source: PRSource): Promise<void> {
    if (!app.activeRepo || app.prsSource === source) return;
    prsSourceByRepo.set(app.activeRepo.id, source);
    app.prsSource = source;
    app.prs = [];
    app.prsHasMore = false;
    prsPage = 0;
    await actions.loadPRs();
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
    const host = prHostArgs(commentablePR());
    app.loadingComments = true;
    try {
      const comments = await window.api.github.listReviewComments(
        app.activeRepo.id,
        prNumber,
        ...host,
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
    const host = prHostArgs(commentablePR());
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
            ...host,
          )
        : await window.api.github.createReviewComment(
            app.activeRepo.id,
            {
              prNumber,
              path: c.filePath,
              line: c.line,
              side: c.side,
              body: c.draft.trim(),
            },
            ...host,
          );
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

  // Post a reply to an existing thread directly from an inline input, without
  // going through the pendingComposer/annotation machinery — the inline reply
  // box stays put rather than swapping in a separate composer row. Returns true
  // on success so the caller can clear its input.
  async submitReply(
    filePath: string,
    replyTo: number,
    body: string,
  ): Promise<boolean> {
    if (!app.activeRepo) return false;
    const prNumber = commentablePRNumber();
    if (prNumber == null) return false;
    const trimmed = body.trim();
    if (!trimmed) return false;
    const host = prHostArgs(commentablePR());
    try {
      const created = await window.api.github.replyReviewComment(
        app.activeRepo.id,
        prNumber,
        replyTo,
        trimmed,
        ...host,
      );
      const existing = app.prComments[filePath] ?? [];
      app.prComments = {
        ...app.prComments,
        [filePath]: [...existing, created],
      };
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
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
      await window.api.github.deleteReviewComment(
        app.activeRepo.id,
        commentId,
        ...prHostArgs(commentablePR()),
      );
    } catch (err) {
      app.prComments = { ...app.prComments, [filePath]: prev };
      setError(err instanceof Error ? err.message : String(err));
    }
  },

  // Resolve / unresolve a review thread. A thread can span files (and every
  // comment in it carries the same threadId), so we flip `isResolved` on every
  // matching comment across the whole map. Optimistic, with rollback + a
  // reconcile to the server's reported state on success.
  async setThreadResolved(threadId: string, resolved: boolean): Promise<void> {
    if (!app.activeRepo) return;
    const prev = app.prComments;
    const apply = (value: boolean): void => {
      const next: Record<string, PRReviewComment[]> = {};
      for (const [path, list] of Object.entries(prev)) {
        next[path] = list.map((c) =>
          c.threadId === threadId ? { ...c, isResolved: value } : c,
        );
      }
      app.prComments = next;
    };
    apply(resolved);
    try {
      const res = await window.api.github.setReviewThreadResolved(
        app.activeRepo.id,
        threadId,
        resolved,
      );
      // Reconcile if GitHub ended up in a different state than we assumed.
      if (res.isResolved !== resolved) apply(res.isResolved);
    } catch (err) {
      app.prComments = prev;
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

  // Create a new branch. `checkout` decides whether we switch onto it as part
  // of creating it: true → `checkout -b` (the working tree follows along);
  // false → `git branch` (the branch is created but we stay put). The create
  // dialog creates without switching while the user is still deciding what to
  // do with a dirty working tree, then switches separately via checkoutBranch.
  async createBranch(
    name: string,
    opts: { base?: string; checkout: boolean },
  ): Promise<boolean> {
    if (!app.activeRepo) return false;
    try {
      const result = await window.api.git.createBranch(
        app.activeRepo.id,
        name,
        {
          base: opts.base,
          checkout: opts.checkout,
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

  // Delete a branch. `deleteRemote` additionally removes its tracking branch on
  // the remote — only meaningful when the branch actually has one. The remote
  // ref is derived in the main process from the branch's stored upstream.
  async deleteBranch(
    name: string,
    opts: { deleteRemote: boolean },
  ): Promise<boolean> {
    if (!app.activeRepo) return false;
    const upstream = app.branches.find((b) => b.name === name)?.upstream;
    try {
      const result = await window.api.git.deleteBranch(
        app.activeRepo.id,
        name,
        {
          deleteRemote: opts.deleteRemote,
          upstream,
        },
      );
      if (!result.ok) {
        setError(result.error ?? "Could not delete branch.");
        return false;
      }
      await Promise.all([refreshBranches(), refreshPushStatus()]);
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

  // Commit the checked working-tree files. Pushing is a separate, explicit
  // step driven by the header push button.
  async commit(summary: string, description?: string): Promise<boolean> {
    if (!app.activeRepo || app.push.inProgress) return false;
    const repoId = app.activeRepo.id;
    const trimmedSummary = summary.trim();
    if (!trimmedSummary) return false;
    // Everything not explicitly unchecked is included. For renames we stage
    // both sides so git records the move rather than an add + orphaned delete.
    const included = app.changedFiles.filter(
      (f) => !app.excludedFromCommit.has(f.path),
    );
    if (included.length === 0) return false;
    const paths: string[] = [];
    for (const f of included) {
      paths.push(f.path);
      if (f.oldPath) paths.push(f.oldPath);
    }
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
      const commit = await window.api.git.commit(repoId, message, paths);
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

  // Pop up the native file-row context menu, then run whatever the user chose.
  // The destructive discard is confirmed natively in the main process, so by
  // the time "discard" comes back the user has already agreed.
  async showFileContextMenu(file: ChangedFile): Promise<void> {
    if (!app.activeRepo) return;
    const editor = effectiveEditor();
    const revealLabel =
      app.platform === "win32"
        ? "Reveal in Explorer"
        : app.platform === "linux"
          ? "Reveal in File Manager"
          : "Reveal in Finder";
    const action = await window.api.menu.showFileContextMenu({
      filePath: file.path,
      canDiscard: app.diffContext.kind === "workingTree",
      editorLabel: editor ? EDITOR_LABELS[editor] : null,
      revealLabel,
    });
    switch (action) {
      case "discard":
        await actions.discardFile(file.path, file.oldPath);
        break;
      case "copyPath":
        await actions.copyToClipboard(
          actions.resolveRepoPath(file.path) ?? file.path,
        );
        break;
      case "copyRelativePath":
        await actions.copyToClipboard(file.path);
        break;
      case "reveal":
        await actions.revealFile(file.path);
        break;
      case "openInEditor":
        await actions.openInEditor(file.path);
        break;
      case "openDefault":
        await actions.openFileWithDefault(file.path);
        break;
    }
  },

  // Discard a file's changes via the file-list context menu. Tracked files are
  // reverted to HEAD; new/untracked files are moved to the trash.
  //
  // Rather than re-fetching the whole file list (which swaps in fresh
  // ChangedFile objects and makes every diff section re-render — a visible
  // flash), we surgically drop just the discarded file: its sidebar row and
  // its diff section. Every other file keeps its identity, so nothing else
  // re-renders.
  async discardFile(filePath: string, oldPath?: string): Promise<void> {
    if (!app.activeRepo) return;
    const repoId = app.activeRepo.id;
    try {
      await window.api.git.discardChanges(repoId, filePath, oldPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    const idx = app.changedFiles.findIndex((f) => f.path === filePath);
    if (idx === -1) return; // already gone — nothing to update
    const remaining = app.changedFiles.filter((f) => f.path !== filePath);

    // If the discarded file was the open one, move the selection to a neighbor
    // (next, else previous) so the diff view lands somewhere sensible.
    if (app.selectedFile === filePath) {
      const next = remaining[idx] ?? remaining[idx - 1] ?? null;
      app.selectedFile = next?.path ?? null;
    }

    app.changedFiles = remaining;
    if (app.seenFiles.has(filePath)) {
      const seen = new Set(app.seenFiles);
      seen.delete(filePath);
      app.seenFiles = seen;
    }
    if (app.collapsedFiles.has(filePath)) {
      const collapsed = new Set(app.collapsedFiles);
      collapsed.delete(filePath);
      app.collapsedFiles = collapsed;
    }

    // Discard only happens in the working-tree context, where the file list IS
    // the unstaged set — keep the tab badge in step.
    const ctx = $state.snapshot(app.diffContext) as DiffContext;
    if (ctx.kind === "workingTree") app.unstagedFileCount = remaining.length;

    // Drop the stale cached diff and prune the per-context files cache so a tab
    // switch (which hydrates from cache) can't resurrect the discarded file.
    diffCache.delete(diffCacheKeyFor(repoId, ctx, filePath));
    const cached = filesCache.get(filesCacheKey(repoId, ctx));
    if (cached) {
      cached.changedFiles = cached.changedFiles.filter(
        (f) => f.path !== filePath,
      );
      cached.seenFiles.delete(filePath);
      cached.collapsedFiles.delete(filePath);
      if (cached.selectedFile === filePath) {
        cached.selectedFile = app.selectedFile;
      }
    }

    // Push status can shift (e.g. discarding leaves the tree clean); refresh it
    // in the background since it only feeds the header, not the diff/sidebar.
    void refreshPushStatus();
  },

  // Resolve a repo-relative path to an absolute one for the shell helpers.
  resolveRepoPath(filePath: string): string | null {
    if (!app.activeRepo) return null;
    return `${app.activeRepo.path}/${filePath}`;
  },

  // Reveal a file in the OS file manager (Finder / Explorer).
  async revealFile(filePath: string): Promise<void> {
    const full = actions.resolveRepoPath(filePath);
    if (!full) return;
    await window.api.shell.showItemInFolder(full);
  },

  // Open a file with the OS default program for its type.
  async openFileWithDefault(filePath: string): Promise<void> {
    const full = actions.resolveRepoPath(filePath);
    if (!full) return;
    const result = await window.api.shell.openPath(full);
    if (!result.ok && result.error) setError(result.error);
  },

  // Copy text (a file path) to the clipboard.
  async copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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

  // Set the file list layout for the active sidebar tab. Unstaged and branch
  // each persist their own layout; the 'sessions' tab has no file list so it
  // falls through to the unstaged setting harmlessly.
  async setFileListLayout(layout: FileListLayout): Promise<void> {
    if (app.contextTab === "branch") {
      app.branchFileListLayout = layout;
      app.prefs = await window.api.state.setPrefs({ branchFileListLayout: layout });
    } else {
      app.unstagedFileListLayout = layout;
      app.prefs = await window.api.state.setPrefs({ unstagedFileListLayout: layout });
    }
  },

  async setShowFileIcons(show: boolean): Promise<void> {
    app.showFileIcons = show;
    app.prefs = await window.api.state.setPrefs({ showFileIcons: show });
  },

  async setOpenFileOnArrowNav(value: boolean): Promise<void> {
    app.openFileOnArrowNav = value;
    app.prefs = await window.api.state.setPrefs({ openFileOnArrowNav: value });
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

  async setAnimationsEnabled(enabled: boolean): Promise<void> {
    app.animationsEnabled = enabled;
    app.prefs = await window.api.state.setPrefs({ animationsEnabled: enabled });
  },

  async setHotkeys(hotkeys: Hotkeys): Promise<void> {
    app.hotkeys = hotkeys;
    app.prefs = await window.api.state.setPrefs({ hotkeys });
  },

  async setTheme(theme: "light" | "dark"): Promise<void> {
    app.theme = theme;
    applyTheme(theme);
    app.prefs = await window.api.state.setPrefs({ theme });
  },

  async setCodeFont(font: string): Promise<void> {
    app.codeFont = font;
    applyFonts();
    app.prefs = await window.api.state.setPrefs({ codeFont: font });
  },

  async setUiFont(font: string): Promise<void> {
    app.uiFont = font;
    applyFonts();
    app.prefs = await window.api.state.setPrefs({ uiFont: font });
  },

  openSettingsDialog(): void {
    app.settingsDialogOpen = true;
  },
  closeSettingsDialog(): void {
    app.settingsDialogOpen = false;
  },

  openCommandMenu(): void {
    app.commandMenuOpen = true;
  },
  closeCommandMenu(): void {
    app.commandMenuOpen = false;
  },
  toggleCommandMenu(): void {
    app.commandMenuOpen = !app.commandMenuOpen;
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

  async refreshBranchPRChecks(): Promise<void> {
    await refreshBranchPRChecks();
  },

  async refreshGithubAccounts(): Promise<void> {
    await refreshGithubAccounts();
  },

  // Set the app-wide default account (configured in Settings). Projects that
  // haven't pinned their own account follow this.
  async setDefaultGithubAccount(id: string): Promise<void> {
    const next = await window.api.github.setActiveAccount(id);
    if (!next) return;
    app.activeGithubAccount = next;
    // Only projects following the default are affected; pinned projects keep
    // their own account, so leave their PR state alone.
    if (
      !app.activeRepo?.githubAccountId &&
      app.activeRepo?.githubOwner &&
      app.activeRepo.githubRepo
    ) {
      app.prs = [];
      void actions.loadPRs();
      void refreshBranchPR();
    }
  },

  // Pin (or unpin, when id is null) the GitHub account the active project uses.
  async setRepoGithubAccount(id: string | null): Promise<void> {
    const repoId = app.activeRepo?.id;
    if (!repoId) return;
    const updated = await window.api.github.setRepoAccount(repoId, id);
    if (!updated || app.activeRepo?.id !== updated.id) return;
    app.activeRepo = updated;
    const idx = app.repos.findIndex((r) => r.id === updated.id);
    if (idx !== -1) app.repos[idx] = updated;
    app.prs = [];
    if (updated.githubOwner && updated.githubRepo) {
      void actions.loadPRs();
      // The new account may see a different (or newly visible) PR for this
      // branch, so re-resolve it rather than leaving the stale result.
      void refreshBranchPR();
    }
  },

  async removeGithubAccount(id: string): Promise<void> {
    await window.api.github.removeAccount(id);
    await refreshGithubAccounts();
    // The account may have been a project's pinned account; the backend unpins
    // those, so re-sync the active repo to reflect the fallback.
    app.activeRepo = await window.api.repos.getActive();
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
