import type { Hotkeys } from './hotkeys.js';

export interface RepoInfo {
	id: string;
	path: string;
	name: string;
	iconDataUrl?: string;
	remoteUrl?: string;
	githubOwner?: string;
	githubRepo?: string;
	// When this repo is a fork, the parent ("upstream") repo's owner/name as
	// reported by the GitHub API. Lets the UI offer the upstream's PRs alongside
	// the fork's own. Unset when the repo isn't a fork (or hasn't been checked).
	upstreamOwner?: string;
	upstreamRepo?: string;
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
	// For image files (raster or SVG): `data:` URLs of the old/new bytes, used to
	// render the two versions side by side. Undefined when the file isn't an
	// image, the side doesn't exist (added has no old, deleted has no new), or
	// the bytes exceeded the image size cap. Raster images carry these *instead*
	// of `oldContents`/`newContents` (which would be useless binary); SVGs carry
	// both so they can also show a source diff.
	oldImage?: string;
	newImage?: string;
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
	// True when the PR has been merged. `state` is "closed" for both merged and
	// plain-closed PRs, so this distinguishes the two for the status icon.
	merged: boolean;
	// The repo the PR's head branch lives in — the contributor's fork for a
	// cross-repo PR, or the base repo for a same-repo PR. Used to set up branch
	// tracking on checkout so commits push back to the PR. Both undefined when
	// the head repo has been deleted.
	headRepoCloneUrl?: string;
	headRepoOwner?: string;
	headRepoName?: string;
	// Whether the PR opts into "allow edits from maintainers". Combined with the
	// viewer's push access to the base repo, this determines whether the viewer
	// can push commits to the PR branch. Undefined when the listing endpoint
	// didn't include it (resolved lazily server-side when needed).
	maintainerCanModify?: boolean;
	// The repo that hosts the PR itself (its base repo) — where its comments,
	// reviews and checks live. For an upstream PR this is the parent repo, not
	// the fork, so PR operations must target it rather than the active repo.
	repoOwner?: string;
	repoName?: string;
}

// Aggregated CI/workflow status for a PR's head commit. Mirrors GitHub's
// combined-status precedence: any failure wins, then any still-running run,
// else success. 'none' means nothing reported any checks.
export type PRChecksState = 'success' | 'failure' | 'pending' | 'none';

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
	| { kind: 'branch'; base: string; head: string }
	| { kind: 'workingTree' }
	| { kind: 'pr'; prNumber: number }
	// A frozen snapshot of changes documented by a coding agent. Files don't come
	// from git — they're read back from the session manifest on disk.
	| { kind: 'session'; sessionId: string };

// Which coding-agent harness produced a session. Drives the logo shown on the
// session card; "other" falls back to a generic icon + `harnessLabel`.
export type HarnessKind = 'claude-code' | 'cursor' | 'codex' | 'opencode' | 'copilot' | 'other';

// A single changed file frozen into a session: the diff metadata plus the
// captured patch and file contents, so the session renders without touching
// git. Contents are "" for added/deleted/binary/truncated sides, matching the
// conventions of `DiffData`.
export interface SessionFile {
	path: string;
	oldPath?: string;
	status: FileStatus;
	additions: number;
	deletions: number;
	isBinary: boolean;
	patch: string;
	oldContents: string;
	newContents: string;
	truncated: boolean;
	// Frozen `data:` URLs for image files, mirroring DiffData. Undefined for
	// non-image files or sides that don't exist. Captured so a session's image
	// diffs render without touching git.
	oldImage?: string;
	newImage?: string;
}

// Listing-level view of a session — everything but the (potentially large)
// per-file contents, so the Sessions tab can render the list cheaply.
export interface SessionSummary {
	id: string;
	repoId: string;
	// The harness's own conversation/run id. Used by the CLI to upsert: the same
	// key re-captures (updates) the existing session instead of creating a new
	// one. Undefined for sessions created without a key.
	key?: string;
	name: string;
	description: string;
	harness: HarnessKind;
	// Freeform harness name shown when `harness === "other"`.
	harnessLabel?: string;
	// Optional deep link back to the agent run (resume/permalink). When present
	// the card shows an "open in harness" button.
	harnessUrl?: string;
	// Branch the snapshot was taken on, and the commit it was diffed against.
	branch?: string;
	baseRef?: string;
	createdAt: number;
	// Bumped on every re-capture so the list can sort by most-recently-updated.
	updatedAt: number;
	fileCount: number;
	additions: number;
	deletions: number;
	// Number of tour steps. 0 for a flat session saved without a tour, which
	// renders as a plain file list.
	stepCount: number;
}

// A callout pins commentary to a specific line range within a file's diff, so
// the agent can say "look right here" instead of describing it in prose. The
// range is 1-based inclusive on the given side of the frozen diff, so it never
// drifts. `body` is Markdown.
export interface SessionCallout {
	// Stable id within the session, assigned at capture.
	id: string;
	// The file this callout sits in (one of its step's files).
	file: string;
	startLine: number;
	endLine: number;
	// Which side the line numbers refer to: "new" = additions (the new file),
	// "old" = deletions (the original).
	side: 'new' | 'old';
	body: string;
}

// One stop on a session's guided tour: a titled, explained group of related
// changed files, so the reviewer reads the change as a narrative instead of an
// alphabetical pile of diffs. `body` is Markdown commentary; `paths` reference
// files in the session's `files`, in the order the agent wants them read.
// `callouts` optionally pin finer-grained notes to line ranges within them.
export interface SessionStep {
	// Stable id within the session, assigned at capture.
	id: string;
	title: string;
	body: string;
	paths: string[];
	callouts: SessionCallout[];
}

// A full session: its summary, the guided tour, and the frozen per-file diffs.
export interface Session extends SessionSummary {
	files: SessionFile[];
	// Ordered tour steps. Empty when saved without a tour; then `files` is shown
	// as a flat list with no step headers.
	steps: SessionStep[];
}

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
	side: 'LEFT' | 'RIGHT';
	// Top-level comment id this one is replying to (if any).
	inReplyTo?: number;
	// The viewer's permission to delete: true when this comment was authored
	// by the active GitHub account.
	canDelete: boolean;
	// GraphQL node id of the review thread this comment belongs to. Needed to
	// resolve/unresolve the thread (the REST API can't). Undefined when the
	// thread couldn't be resolved (e.g. GraphQL lookup failed, or a comment we
	// just created locally that hasn't been refetched yet).
	threadId?: string;
	// Whether the comment's review thread is resolved on GitHub. Sourced from
	// GraphQL — the REST review-comment payload doesn't expose it — so it
	// defaults to false when the thread lookup is unavailable.
	isResolved: boolean;
}

export interface NewReviewCommentInput {
	prNumber: number;
	path: string;
	body: string;
	line: number;
	side: 'LEFT' | 'RIGHT';
}

export type ViewMode = 'split' | 'unified';

// How the sidebar file list is laid out. 'tree' groups files into nested
// folders (VSCode-style); 'list' flattens to one file per row.
export type FileListLayout = 'tree' | 'list';

// Which tab in the file list drives `DiffContext`. Persisted so the app
// restores the last tab on launch.
export type ContextTab = 'unstaged' | 'branch' | 'sessions';

// Which GitHub repo a PR listing/checkout targets: the repo's own remote
// ("fork") or, when the repo is a fork, its parent ("upstream").
export type PRSource = 'fork' | 'upstream';

export type EditorKind = 'cursor' | 'vscode' | 'zed' | 'xcode' | 'visualstudio';

export type TerminalKind = 'terminal' | 'iterm' | 'warp' | 'ghostty' | 'cmd' | 'powershell';

export type AppPlatform = 'darwin' | 'win32' | 'linux';

// Actions a file row's native context menu can return. `null` (from the IPC)
// means the menu was dismissed without a choice. The `*Selected` variants act
// on the sidebar's whole multi-selection (cmd/shift-click) rather than the
// single right-clicked file.
export type FileContextMenuAction =
	| 'discard'
	| 'discardSelected'
	| 'includeSelected'
	| 'excludeSelected'
	| 'copyPath'
	| 'copyRelativePath'
	| 'reveal'
	| 'openInEditor'
	| 'openDefault';

// Actions a branch row's native context menu can return. `null` (from the
// IPC) means the menu was dismissed without a choice.
export type BranchContextMenuAction = 'copy' | 'delete';

// Actions a repo row's native context menu can return. `null` (from the IPC)
// means the menu was dismissed without a choice.
export type RepoContextMenuAction = 'copyPath' | 'reveal' | 'remove';

// Items in the native application menu's "Branch" submenu. The main process
// sends the chosen action to the focused renderer, which runs the matching
// store flow (some open a confirm dialog first).
export type BranchMenuAction =
	| 'newBranch'
	| 'updateFromDefault'
	| 'updateFromUpstream'
	| 'deleteBranch'
	| 'discardAll'
	| 'previewPR'
	| 'createPR';

// Renderer-computed state that decides which "Branch" menu items are enabled
// and what their dynamic labels read. Pushed to the main process whenever it
// changes so the native menu greys out inapplicable items (e.g. "Delete
// Branch" on the default branch), like GitHub Desktop.
export interface BranchMenuState {
	hasRepo: boolean;
	// The repo's default branch name, woven into the "Update from <x>" label.
	defaultBranch: string;
	onDefaultBranch: boolean;
	hasChanges: boolean;
	hasGithub: boolean;
	// True when the repo is a fork with a known parent — enables "Update from
	// upstream/<default>".
	hasUpstream: boolean;
	// The open PR for the current branch, if any — flips "Create" to "View".
	branchPRNumber: number | null;
}

// What the renderer hands the main process to build a repo row's native menu.
export interface RepoContextMenuParams {
	// The repo's display name — used in the "Remove" item's label.
	name: string;
	// Platform-specific file-manager label, e.g. "Reveal in Finder".
	revealLabel: string;
}

// What the renderer hands the main process to build a branch row's native menu.
export interface BranchContextMenuParams {
	// The branch name — shown back to the user isn't needed here, but kept for
	// parity/labelling if the menu grows.
	name: string;
	// Whether to show "Delete Branch…" — hidden for the currently checked-out
	// branch (which git can't delete anyway).
	canDelete: boolean;
}

// What the renderer hands the main process to build a file row's native menu.
// The labels are resolved renderer-side (platform name, configured editor) so
// the main process just renders them.
export interface FileContextMenuParams {
	// Repo-relative path of the file the menu targets — used in the discard
	// confirmation message.
	filePath: string;
	// Whether to show "Discard Changes" (only meaningful for working-tree
	// changes, not committed branch/PR diffs).
	canDiscard: boolean;
	// Label for the "Open in <editor>" item, or null to hide it when no editor
	// is configured/detected.
	editorLabel: string | null;
	// Platform-specific file-manager label, e.g. "Reveal in Finder".
	revealLabel: string;
	// How many files are in the sidebar's current multi-selection. When > 1 the
	// menu leads with bulk actions ("Discard N Files", etc.) that operate on the
	// whole selection instead of just `filePath`.
	selectedCount: number;
	// Whether to offer commit Include/Exclude items — only in the Unstaged tab,
	// where the file list drives which changes go into the next commit.
	canInclude: boolean;
}

// Which editors/terminals make sense to offer per OS. The Settings UI only
// lists these (e.g. Xcode/iTerm are macOS-only, Visual Studio is Windows-only).
export const EDITORS_BY_PLATFORM: Record<AppPlatform, EditorKind[]> = {
	darwin: ['cursor', 'vscode', 'zed', 'xcode'],
	win32: ['cursor', 'vscode', 'zed', 'visualstudio'],
	linux: ['cursor', 'vscode', 'zed']
};

export const TERMINALS_BY_PLATFORM: Record<AppPlatform, TerminalKind[]> = {
	darwin: ['terminal', 'iterm', 'warp', 'ghostty'],
	win32: ['cmd', 'powershell'],
	linux: []
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
	// Commits the default branch has that this branch doesn't — how far behind the
	// default the branch is, and what "update from <default>" would merge in.
	// Compared against origin/<default> when a remote exists, else the local
	// default branch. 0 on the default branch itself.
	behindDefault: number;
	// Name of the remote the branch's upstream lives on (`branch.<x>.remote`).
	// Usually "origin", but a checked-out PR branch tracks the PR's head repo
	// remote. Undefined when there's no upstream. Drives accurate push labels.
	pushRemote?: string;
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

// One file's contribution to a commit. For whole-file staging only `path`
// (and `oldPath` for renames) is set and the file's full working-tree version
// is committed. For partial (line/hunk) staging `patch` carries a ready-to-
// apply unified diff (HEAD -> the desired subset of changes); the backend
// applies it to a scratch index so only the selected lines land in the commit.
export interface CommitFileSelection {
	path: string;
	oldPath?: string;
	patch?: string;
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

export interface DeleteBranchResult {
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

// Options for the GitHub-Desktop-style "Create new repository" flow. The repo
// is created at `<path>/<name>` and optionally scaffolded with a README, a
// .gitignore (from a bundled template), and a LICENSE.
export interface CreateRepoOptions {
	/** Parent directory the new repo folder is created inside. */
	path: string;
	/** Repo folder name (also used as the project title in the README). */
	name: string;
	/** Optional one-line description, written to the README and .git/description. */
	description?: string;
	/** Seed the repo with a README.md. */
	initReadme?: boolean;
	/** .gitignore template label (see repos.getCreateDefaults), or null for none. */
	gitignore?: string | null;
	/** License template label (see repos.getCreateDefaults), or null for none. */
	license?: string | null;
}

// Defaults the create-repo form loads up front: a suggested parent directory
// and the available template labels for the two dropdowns.
export interface CreateRepoDefaults {
	defaultPath: string;
	gitignores: string[];
	licenses: string[];
}

// Accent palette: 'super' is the brand flame, 'mono' the neutral monochrome
// primary. Each maps to an `.accent-*` class in app.css.
export type Accent = 'super' | 'mono';

export interface UserPrefs {
	viewMode: ViewMode;
	theme: 'light' | 'dark';
	accent: Accent;
	activeRepoId?: string;
	contextTab?: ContextTab;
	externalEditor?: EditorKind | null;
	externalTerminal?: TerminalKind | null;
	// File list layout is tracked per sidebar tab so the user can keep, say, a
	// tree in Unstaged and a flat list in Branch.
	unstagedFileListLayout: FileListLayout;
	branchFileListLayout: FileListLayout;
	showFileIcons: boolean;
	// When true, moving the file-tree keyboard cursor onto a file opens its diff
	// immediately. When false, arrows only move the focus ring and Enter/Space
	// opens the focused file.
	openFileOnArrowNav: boolean;
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
	// When true, UI components include shadcn-svelte's enter/exit and transition
	// animation classes. Off by default — components render without motion unless
	// the user opts in. Consumed via the useAnimations() context hook.
	animationsEnabled: boolean;
	// User-configurable keyboard shortcuts, keyed by action. See DEFAULT_HOTKEYS
	// in @shared/hotkeys for the defaults and matching semantics.
	hotkeys: Hotkeys;
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
	| { state: 'pending' }
	| { state: 'success'; account: GithubAccount }
	| { state: 'error'; message: string };

export interface PreloadAPI {
	platform: AppPlatform;
	repos: {
		list(): Promise<RepoInfo[]>;
		openPicker(): Promise<RepoInfo | null>;
		// Register an existing git repo at a known path (no picker). Backs the
		// create-repo form's "this is already a repo — add it instead" shortcut.
		addByPath(path: string): Promise<RepoInfo | null>;
		// Pick a parent folder; scan it for git repos, add them all, and return the
		// ones that were found (empty if the picker was cancelled).
		openFolder(): Promise<RepoInfo[]>;
		// Open a folder picker and return the chosen parent directory (null if
		// cancelled). Used by the create-repo form's "Choose…" button.
		chooseDirectory(): Promise<string | null>;
		// Whether `path` is already a git repository — drives the form's "this is
		// already a repo, add it instead?" hint.
		isGitRepo(path: string): Promise<boolean>;
		// Suggested parent directory + template labels for the create-repo form.
		getCreateDefaults(): Promise<CreateRepoDefaults>;
		// Scaffold a new repository (folder, git init, README/.gitignore/LICENSE).
		// Returns the registered repo, or null if the picker/flow was cancelled.
		createRepo(options: CreateRepoOptions): Promise<RepoInfo | null>;
		// De-register a repo. When `moveToTrash` is set, the repo's folder is also
		// moved to the OS trash (mirrors GitHub Desktop's remove dialog).
		remove(id: string, moveToTrash?: boolean): Promise<void>;
		setActive(id: string): Promise<RepoInfo | null>;
		getActive(): Promise<RepoInfo | null>;
	};
	git: {
		listBranches(repoId: string): Promise<BranchInfo[]>;
		getCurrentBranch(repoId: string): Promise<string | null>;
		checkout(repoId: string, branch: string): Promise<void>;
		checkoutPR(repoId: string, pr: PRSummary, source?: PRSource): Promise<void>;
		isDirty(repoId: string): Promise<boolean>;
		createBranch(
			repoId: string,
			name: string,
			opts: { base?: string; checkout: boolean }
		): Promise<CreateBranchResult>;
		deleteBranch(
			repoId: string,
			name: string,
			opts: { deleteRemote: boolean; upstream?: string }
		): Promise<DeleteBranchResult>;
		listChangedFiles(repoId: string, ctx: DiffContext): Promise<ChangedFile[]>;
		getDiff(repoId: string, filePath: string, ctx: DiffContext): Promise<DiffData>;
		fetchOrigin(repoId: string): Promise<{ ok: boolean; error?: string }>;
		getPushStatus(repoId: string): Promise<PushStatus>;
		pull(repoId: string): Promise<PullPushResult>;
		push(repoId: string): Promise<PullPushResult>;
		// Merge `ref` (e.g. "origin/main") into the current branch. Conflicts come
		// back the same way pull does, driving the shared conflict dialog.
		mergeIntoCurrent(repoId: string, ref: string): Promise<PullPushResult>;
		// For a fork: fetch the parent repo's `branch` and merge it into the current
		// branch ("Update from upstream/<branch>"). Conflicts surface like pull.
		updateFromUpstream(repoId: string, branch: string): Promise<PullPushResult>;
		getConflicts(repoId: string): Promise<string[]>;
		// Re-scan the given conflict files: stage any whose conflict markers are
		// gone, and return the paths still unresolved (markers remaining).
		recheckConflicts(repoId: string, files: string[]): Promise<string[]>;
		stageFile(repoId: string, filePath: string): Promise<void>;
		// Discard a file's working-tree + staged changes. `oldPath` is the
		// pre-rename path, so discarding a rename also restores the original.
		discardChanges(repoId: string, filePath: string, oldPath?: string): Promise<void>;
		continueMerge(repoId: string): Promise<PullPushResult>;
		abortMerge(repoId: string): Promise<void>;
		// Stage and commit the given files. Each entry is either a whole-file
		// selection or a partial one carrying a unified diff to apply (line/hunk
		// staging) — see CommitFileSelection.
		commit(repoId: string, message: string, files: CommitFileSelection[]): Promise<CommitResult>;
		getLastCommit(repoId: string): Promise<LastCommit | null>;
		undoLastCommit(repoId: string): Promise<CommitResult>;
		cloneRepo(url: string): Promise<CloneResult>;
	};
	editor: {
		detect(): Promise<Record<EditorKind, boolean>>;
		open(editor: EditorKind, target: string): Promise<{ ok: boolean; error?: string }>;
	};
	terminal: {
		detect(): Promise<Record<TerminalKind, boolean>>;
		open(terminal: TerminalKind, target: string): Promise<{ ok: boolean; error?: string }>;
	};
	github: {
		listAccounts(): Promise<GithubAccount[]>;
		getActiveAccount(): Promise<GithubAccount | null>;
		setActiveAccount(id: string): Promise<GithubAccount | null>;
		removeAccount(id: string): Promise<void>;
		setRepoAccount(repoId: string, accountId: string | null): Promise<RepoInfo | null>;
		startDeviceFlow(): Promise<DeviceFlowStart>;
		pollDeviceFlow(): Promise<DeviceFlowStatus>;
		cancelDeviceFlow(): Promise<void>;
		listPRs(repoId: string, page?: number, source?: PRSource): Promise<PRSummary[]>;
		// Resolve (and persist) the repo's upstream/parent if it's a fork. Returns
		// the updated RepoInfo (with upstreamOwner/upstreamRepo set or cleared).
		detectUpstream(repoId: string): Promise<RepoInfo | null>;
		// `owner`/`repo` name the PR's host (base) repo — the parent for an upstream
		// PR on a fork — so the head and base refs are fetched from the right repo.
		// Omitted, they fall back to the active repo's own coordinates.
		fetchPR(
			repoId: string,
			prNumber: number,
			owner?: string,
			repo?: string
		): Promise<{ headRef: string; baseRef: string }>;
		findPRForBranch(repoId: string, branch: string): Promise<PRSummary | null>;
		// PR operations accept the PR's host repo (owner/repo) so they target the
		// right repository — an upstream PR lives on the parent, not the fork.
		// When omitted, the active repo's own coordinates are used.
		// Whether the active account can push commits to the PR's head branch
		// (direct push access to the head repo, or maintainer-edit on the base).
		canPushToPR(repoId: string, pr: PRSummary): Promise<boolean>;
		getChecks(repoId: string, ref: string, owner?: string, repo?: string): Promise<PRChecksSummary>;
		getPR(
			repoId: string,
			prNumber: number,
			owner?: string,
			repo?: string
		): Promise<PRSummary | null>;
		listReviewComments(
			repoId: string,
			prNumber: number,
			owner?: string,
			repo?: string
		): Promise<PRReviewComment[]>;
		createReviewComment(
			repoId: string,
			input: NewReviewCommentInput,
			owner?: string,
			repo?: string
		): Promise<PRReviewComment>;
		replyReviewComment(
			repoId: string,
			prNumber: number,
			commentId: number,
			body: string,
			owner?: string,
			repo?: string
		): Promise<PRReviewComment>;
		deleteReviewComment(
			repoId: string,
			commentId: number,
			owner?: string,
			repo?: string
		): Promise<void>;
		// Resolve or unresolve a review thread by its GraphQL node id. Returns the
		// thread's resolved state as reported back by GitHub.
		setReviewThreadResolved(
			repoId: string,
			threadId: string,
			resolved: boolean
		): Promise<{ isResolved: boolean }>;
	};
	state: {
		getPrefs(): Promise<UserPrefs>;
		setPrefs(patch: Partial<UserPrefs>): Promise<UserPrefs>;
		getSeenFiles(repoId: string, contextKey: string): Promise<string[]>;
		setFileSeen(repoId: string, contextKey: string, filePath: string, seen: boolean): Promise<void>;
		clearSeen(repoId: string, contextKey: string): Promise<void>;
		getCollapsedFiles(repoId: string, contextKey: string): Promise<string[]>;
		setFileCollapsed(
			repoId: string,
			contextKey: string,
			filePath: string,
			collapsed: boolean
		): Promise<void>;
		clearCollapsedFiles(repoId: string, contextKey: string): Promise<void>;
		getCommitDraft(repoId: string): Promise<CommitDraft>;
		setCommitDraft(repoId: string, draft: CommitDraft): Promise<void>;
	};
	sessions: {
		list(repoId: string): Promise<SessionSummary[]>;
		get(repoId: string, id: string): Promise<Session | null>;
		remove(repoId: string, id: string): Promise<void>;
	};
	skill: {
		// Whether the document-session skill is installed in the repo
		// (`.claude/skills/document-session/SKILL.md` exists).
		isInstalled(repoId: string): Promise<boolean>;
		// Write the bundled document-session skill into the repo.
		install(repoId: string): Promise<void>;
	};
	shell: {
		openExternal(url: string): Promise<void>;
		// Reveal a file in the OS file manager (Finder / Explorer), selecting it.
		showItemInFolder(fullPath: string): Promise<void>;
		// Open a file with the OS default program for its type.
		openPath(fullPath: string): Promise<{ ok: boolean; error?: string }>;
	};
	menu: {
		// Pop up a native OS context menu for a file row. Resolves to the chosen
		// action, or null when the menu is dismissed without a selection.
		showFileContextMenu(params: FileContextMenuParams): Promise<FileContextMenuAction | null>;
		// Pop up a native OS context menu for a branch row. Resolves to the chosen
		// action, or null when the menu is dismissed without a selection.
		showBranchContextMenu(params: BranchContextMenuParams): Promise<BranchContextMenuAction | null>;
		// Pop up a native OS context menu for a repo row in the picker. Resolves to
		// the chosen action, or null when the menu is dismissed without a selection.
		showRepoContextMenu(params: RepoContextMenuParams): Promise<RepoContextMenuAction | null>;
		// Push the latest Branch-menu enablement/labels to the main process so it
		// can rebuild the native application menu. Fire-and-forget.
		setBranchState(state: BranchMenuState): void;
	};
	windowControls: {
		// Re-center the macOS traffic lights for the renderer's current zoom factor.
		sync(): void;
	};
	events: {
		onRepoChanged(handler: (repo: RepoInfo | null) => void): () => void;
		// A native "Branch" menu item was chosen. Returns an unsubscribe fn.
		onBranchMenuAction(handler: (action: BranchMenuAction) => void): () => void;
		// A background "move to Trash" (after removing a repo) failed; the payload
		// is the repo's name. Returns an unsubscribe fn.
		onRepoTrashFailed(handler: (name: string) => void): () => void;
	};
}

declare global {
	interface Window {
		api: PreloadAPI;
	}
}
