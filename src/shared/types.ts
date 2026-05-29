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
  // GitHub account this project is pinned to. When unset, the app-wide default
  // (activeGithubAccountId) is used instead.
  githubAccountId?: string;
}

// Author/committer identity applied to a commit, derived from the GitHub
// account a project authenticates as.
export interface GitIdentity {
  name: string;
  email: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  isRemote: boolean;
  // Unix epoch ms of the branch tip's committer date. Undefined when git
  // didn't return a parseable date (very rare — corrupted ref, etc.).
  lastCommitAt?: number;
}

export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "type-change";

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
  state: "open" | "closed";
}

// Aggregated CI/workflow status for a PR's head commit. Mirrors GitHub's
// combined-status precedence: any failure wins, then any still-running run,
// else success. 'none' means nothing reported any checks.
export type PRChecksState = "success" | "failure" | "pending" | "none";

// A single check-run or commit status reported against the head commit.
export interface PRCheck {
  name: string;
  // Per-check rollup. 'none' is never used here — a check is always one of the
  // other three.
  state: PRChecksState;
  // Wall-clock run time in milliseconds, or null when still running or when the
  // source (legacy commit statuses) doesn't expose timing.
  durationMs: number | null;
  // Avatar of the app/integration that reported the check (e.g. GitHub
  // Actions), or null when unavailable.
  avatarUrl: string | null;
}

// Aggregate state plus the individual checks behind it, for a hover breakdown.
export interface PRChecksSummary {
  state: PRChecksState;
  checks: PRCheck[];
}

export type DiffContext =
  | { kind: "branch"; base: string; head: string }
  | { kind: "workingTree" }
  | { kind: "pr"; prNumber: number };

// A review comment attached to a specific line in a PR diff.
// `side: 'RIGHT'` lives in the head file (additions); `'LEFT'` in the base
// file (deletions) — matches GitHub's REST API.
export interface PRReviewComment {
  id: number;
  prNumber: number;
  path: string;
  body: string;
  bodyHtml?: string;
  author: string;
  authorAvatarUrl: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  line: number | null;
  side: "LEFT" | "RIGHT";
  // Top-level comment id this one is replying to (if any).
  inReplyTo?: number;
  // The viewer's permission to delete: true when this comment was authored
  // by the active GitHub account.
  canDelete: boolean;
}

export interface NewReviewCommentInput {
  prNumber: number;
  path: string;
  body: string;
  line: number;
  side: "LEFT" | "RIGHT";
}

export type ViewMode = "split" | "unified";

// How the sidebar file list is laid out. 'tree' groups files into nested
// folders (VSCode-style); 'list' flattens to one file per row.
export type FileListLayout = "tree" | "list";

// Which tab in the file list drives `DiffContext`. Persisted so the app
// restores the last tab on launch.
export type ContextTab = "unstaged" | "branch" | "sessions";

export type EditorKind =
  | "cursor"
  | "vscode"
  | "zed"
  | "xcode"
  | "visualstudio";

export type TerminalKind =
  | "terminal"
  | "iterm"
  | "warp"
  | "ghostty"
  | "cmd"
  | "powershell";

export type AppPlatform = "darwin" | "win32" | "linux";

// Which editors/terminals make sense to offer per OS. The Settings UI only
// lists these (e.g. Xcode/iTerm are macOS-only, Visual Studio is Windows-only).
export const EDITORS_BY_PLATFORM: Record<AppPlatform, EditorKind[]> = {
  darwin: ["cursor", "vscode", "zed", "xcode"],
  win32: ["cursor", "vscode", "zed", "visualstudio"],
  linux: ["cursor", "vscode", "zed"],
};

export const TERMINALS_BY_PLATFORM: Record<AppPlatform, TerminalKind[]> = {
  darwin: ["terminal", "iterm", "warp", "ghostty"],
  win32: ["cmd", "powershell"],
  linux: [],
};

export interface PushStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  hasRemote: boolean;
  // Commits this branch has that the repo's default branch does not. Used to
  // decide whether a PR would have any content. 0 when on the default branch
  // or when the branch hasn't diverged.
  aheadOfDefault: number;
}

export interface PullPushResult {
  ok: boolean;
  conflicts: string[];
  error?: string;
}

export interface CommitResult {
  ok: boolean;
  error?: string;
}

export interface LastCommit {
  hash: string;
  subject: string;
  // Relative time string straight from git (e.g. "2 minutes ago").
  relativeTime: string;
  // True when the commit has not yet been pushed to any remote, so undoing it
  // is safe.
  canUndo: boolean;
}

export interface CreateBranchResult {
  ok: boolean;
  error?: string;
}

// An in-progress commit message the user hasn't committed yet. Persisted
// per-repo so switching repos / restarting the app restores what was typed.
export interface CommitDraft {
  summary: string;
  description: string;
}

export interface CloneResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface UserPrefs {
  viewMode: ViewMode;
  theme: "light" | "dark";
  activeRepoId?: string;
  contextTab?: ContextTab;
  externalEditor?: EditorKind | null;
  externalTerminal?: TerminalKind | null;
  fileListLayout: FileListLayout;
  showFileIcons: boolean;
  // Font family for the diff/code surface. "system" uses the built-in
  // monospace stack; any other value is a family name installed on the
  // user's machine.
  codeFont: string;
  // Font family for the app UI (sidebar, lists, chrome). "system" uses the
  // built-in sans stack; any other value is an installed family name.
  uiFont: string;
  // Diffs whose changed-line count (additions + deletions) exceeds this are
  // hidden behind a "Load diff" button by default. 0 disables the size check.
  maxDiffLines: number;
  // Glob patterns whose matching files have their diffs hidden behind a
  // "Load diff" button by default (lock files, build outputs, etc.). See
  // DEFAULT_HIDDEN_DIFF_PATTERNS in @shared/diff-defer for match semantics.
  hiddenDiffPatterns: string[];
}

export interface DeviceFlowStart {
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
  intervalSec: number;
}

export interface GithubAccount {
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  addedAt: number;
}

export type DeviceFlowStatus =
  | { state: "pending" }
  | { state: "success"; account: GithubAccount }
  | { state: "error"; message: string };

export interface PreloadAPI {
  platform: AppPlatform;
  repos: {
    list(): Promise<RepoInfo[]>;
    openPicker(): Promise<RepoInfo | null>;
    createPicker(): Promise<RepoInfo | null>;
    remove(id: string): Promise<void>;
    setActive(id: string): Promise<RepoInfo | null>;
    getActive(): Promise<RepoInfo | null>;
  };
  git: {
    listBranches(repoId: string): Promise<BranchInfo[]>;
    getCurrentBranch(repoId: string): Promise<string | null>;
    checkout(repoId: string, branch: string): Promise<void>;
    isDirty(repoId: string): Promise<boolean>;
    createBranch(
      repoId: string,
      name: string,
      opts: { base?: string; checkout: boolean },
    ): Promise<CreateBranchResult>;
    listChangedFiles(repoId: string, ctx: DiffContext): Promise<ChangedFile[]>;
    getDiff(
      repoId: string,
      filePath: string,
      ctx: DiffContext,
    ): Promise<DiffData>;
    fetchOrigin(repoId: string): Promise<{ ok: boolean; error?: string }>;
    getPushStatus(repoId: string): Promise<PushStatus>;
    pull(repoId: string): Promise<PullPushResult>;
    push(repoId: string): Promise<PullPushResult>;
    getConflicts(repoId: string): Promise<string[]>;
    stageFile(repoId: string, filePath: string): Promise<void>;
    continueMerge(repoId: string): Promise<PullPushResult>;
    abortMerge(repoId: string): Promise<void>;
    commitAll(repoId: string, message: string): Promise<CommitResult>;
    getLastCommit(repoId: string): Promise<LastCommit | null>;
    undoLastCommit(repoId: string): Promise<CommitResult>;
    cloneRepo(url: string): Promise<CloneResult>;
  };
  editor: {
    detect(): Promise<Record<EditorKind, boolean>>;
    open(
      editor: EditorKind,
      target: string,
    ): Promise<{ ok: boolean; error?: string }>;
  };
  terminal: {
    detect(): Promise<Record<TerminalKind, boolean>>;
    open(
      terminal: TerminalKind,
      target: string,
    ): Promise<{ ok: boolean; error?: string }>;
  };
  github: {
    listAccounts(): Promise<GithubAccount[]>;
    getActiveAccount(): Promise<GithubAccount | null>;
    setActiveAccount(id: string): Promise<GithubAccount | null>;
    removeAccount(id: string): Promise<void>;
    setRepoAccount(
      repoId: string,
      accountId: string | null,
    ): Promise<RepoInfo | null>;
    startDeviceFlow(): Promise<DeviceFlowStart>;
    pollDeviceFlow(): Promise<DeviceFlowStatus>;
    cancelDeviceFlow(): Promise<void>;
    listPRs(repoId: string): Promise<PRSummary[]>;
    fetchPR(
      repoId: string,
      prNumber: number,
    ): Promise<{ headRef: string; baseRef: string }>;
    findPRForBranch(repoId: string, branch: string): Promise<PRSummary | null>;
    getChecks(repoId: string, ref: string): Promise<PRChecksSummary>;
    getPR(repoId: string, prNumber: number): Promise<PRSummary | null>;
    listReviewComments(
      repoId: string,
      prNumber: number,
    ): Promise<PRReviewComment[]>;
    createReviewComment(
      repoId: string,
      input: NewReviewCommentInput,
    ): Promise<PRReviewComment>;
    replyReviewComment(
      repoId: string,
      prNumber: number,
      commentId: number,
      body: string,
    ): Promise<PRReviewComment>;
    deleteReviewComment(repoId: string, commentId: number): Promise<void>;
  };
  state: {
    getPrefs(): Promise<UserPrefs>;
    setPrefs(patch: Partial<UserPrefs>): Promise<UserPrefs>;
    getSeenFiles(repoId: string, contextKey: string): Promise<string[]>;
    setFileSeen(
      repoId: string,
      contextKey: string,
      filePath: string,
      seen: boolean,
    ): Promise<void>;
    clearSeen(repoId: string, contextKey: string): Promise<void>;
    getCollapsedFiles(repoId: string, contextKey: string): Promise<string[]>;
    setFileCollapsed(
      repoId: string,
      contextKey: string,
      filePath: string,
      collapsed: boolean,
    ): Promise<void>;
    clearCollapsedFiles(repoId: string, contextKey: string): Promise<void>;
    getCommitDraft(repoId: string): Promise<CommitDraft>;
    setCommitDraft(repoId: string, draft: CommitDraft): Promise<void>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
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
