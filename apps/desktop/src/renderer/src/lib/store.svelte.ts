import type {
	Accent,
	AppPlatform,
	BranchInfo,
	ChangedFile,
	ChangesetStatus,
	CommitFileSelection,
	CommitInfo,
	ContextTab,
	CreateRepoOptions,
	DiffContext,
	DiffData,
	DiffLayout,
	EditorKind,
	ErrorContext,
	ErrorToast,
	FeedbackDraft,
	FeedbackInput,
	FeedbackResult,
	FileListLayout,
	AnimationMode,
	CustomFileIcon,
	GithubAccount,
	GithubAuthError,
	LastCommit,
	LocalComment,
	LocalCommentAuthor,
	ManagedStash,
	PRChecksSummary,
	PRConversationItem,
	PRMergeMethod,
	PRReviewComment,
	PRSource,
	PRSummary,
	PrMergedBehavior,
	PublishRepoOptions,
	PushStatus,
	RepoInfo,
	Session,
	SessionSummary,
	HeaderItemVisibility,
	SidebarTabVisibility,
	TerminalKind,
	UserPrefs,
	ViewMode
} from '@shared/types';
import { DEFAULT_HEADER_ITEMS, DEFAULT_SIDEBAR_TABS, WINDOW_BOUNDS } from '@shared/types';
import { diffContextKey, reviewContextKey } from '@shared/diff-context';
import {
	buildDiscardPatch,
	buildFilteredPatch,
	lineKeySides,
	parseFilePatch,
	stagingLineKey,
	type DiffSide
} from '@shared/diff-staging';
import { DEFAULT_HIDDEN_DIFF_PATTERNS } from '@shared/diff-defer';
import { DEFAULT_HOTKEYS, type Hotkeys } from '@shared/hotkeys';
import { comparePathsVSCodeStyle } from '$lib/utils';
import { DEFAULT_DIFF_THEME, diffThemePair } from '$lib/diff-themes';
import { getDiffWorkerPool, POOL_PERSISTENT_RENDER_OPTIONS } from '$lib/diff-worker-pool';

export type SettingsTab = 'accounts' | 'appearance' | 'behavior' | 'app' | 'editor' | 'hotkeys';
export type SettingsScrollTarget = 'hidden-files';
import { repoFrecency } from '$lib/repo-frecency.svelte';
import { tourFileOrder, tourGroups } from '$lib/session-tour';
import { SvelteSet, SvelteMap } from 'svelte/reactivity';
import {
	upstreamChecked,
	prsSourceByRepo,
	contextTabByRepo,
	viewLayoutByRepo,
	filesCache,
	diffCache,
	prPushAccess,
	repoPushAccessChecked,
	type ScrollAnchor
} from '$lib/store-cache';

// Re-export so existing component imports (`from '$lib/store.svelte'`) keep
// working. The canonical definition lives in @shared/types.
export type { ContextTab };

// Per-file pending composer state — keyed by `${filePath}::${side}::${line}`.
// Used by DiffFileSection to render an inline compose box at the right spot.
export interface PendingComposer {
	filePath: string;
	line: number;
	side: 'LEFT' | 'RIGHT';
	// Optional comment id we're replying to. When set, posting will use the
	// reply endpoint instead of creating a top-level comment.
	replyTo?: number;
	draft: string;
	submitting: boolean;
}

// Pending local-comment compose box, keyed by `composerKey(file, side, line)` —
// the working-tree counterpart of PendingComposer. Local comments are flat (no
// replies), so there's no `replyTo`. Lives in `app.localComposers` and is
// rendered inline by DiffFileSection in any non-PR context.
export interface LocalComposer {
	filePath: string;
	line: number;
	side: 'LEFT' | 'RIGHT';
	draft: string;
	submitting: boolean;
}

// State for the GitHub device-flow sign-in dialog. The flow is driven by an
// explicit action (startGithubSignInFlow) rather than a reactive effect, so
// these fields are just what the dialog renders — the orchestration owns them.
export interface GithubSignInState {
	open: boolean;
	// The device-flow user code and verification URL, populated once the flow
	// starts and the user needs to enter the code in their browser.
	userCode: string | null;
	verificationUri: string | null;
	// True while we're polling GitHub for the user to authorize the code.
	polling: boolean;
	error: string | null;
}

interface AppState {
	repos: RepoInfo[];
	activeRepo: RepoInfo | null;
	branches: BranchInfo[];
	currentBranch: string | null;
	// The branch being reviewed read-only, without checking it out. null means
	// the view follows the checked-out branch (no drift). When set to a branch
	// other than `currentBranch`, the app shows that branch's committed state
	// (the Branch diff + Sessions) by reading from git refs — the working tree is
	// never touched. The Unstaged tab is hidden while it's set, since there's no
	// working tree to commit against for a branch that isn't checked out.
	viewBranch: string | null;
	// The pull request being reviewed read-only, without checking it out. The
	// app fetches the PR's head ref and shows it (vs. the default branch) on the
	// Branch tab — the same diff a checkout would show, but the working tree is
	// never touched. Mutually exclusive with `viewBranch` in practice (entering
	// one clears the other). Like `viewBranch`, it hides the Unstaged tab.
	viewPR: PRSummary | null;
	// The open PR (if any) for the read-only `viewBranch`, looked up so the header
	// reflects what's on screen rather than the checked-out branch. Best-effort
	// and only meaningful while `isViewingOtherBranch()`; `uiPR()` gates on that,
	// so a stale value when we're not viewing a branch is harmless.
	viewBranchPR: PRSummary | null;
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
	// Agent-documented sessions for the active repo, newest-updated first. Shown
	// as a list on the Sessions tab; loaded on entering the tab / refresh.
	sessions: SessionSummary[];
	// Count of the active repo's sessions, kept in sync regardless of the active
	// tab (via the fs watcher) so the Sessions tab can always show a badge.
	sessionCount: number;
	// The session whose frozen diff is currently open, or null when the Sessions
	// tab is showing the list. Ephemeral — not persisted across launches.
	activeSessionId: string | null;
	// Full detail (incl. tour steps) of the open session, loaded alongside its
	// files so the diff view and sidebar can render the tour. null when no
	// session is open or while it's loading.
	activeSessionDetail: Session | null;
	// Which view an open session shows: the narrated "tour" (grouped steps +
	// callouts) or "changes" (the plain file-by-file review, with search and
	// tree/list toggle). Only meaningful while a session with steps is open.
	sessionView: 'tour' | 'changes';
	// Commits on the viewed branch/PR head, newest first — the History tab's list.
	// Loaded on entering the tab / refresh. Empty on other tabs.
	commits: CommitInfo[];
	// Where the History list's head diverged from its base branch: the merge-base
	// SHA (which appears in `commits`) plus a display label for the base. null when
	// there's no base to compare against, the head IS the base, or it couldn't be
	// resolved. Drives the "branched from <base>" divider in the commit list.
	historyForkPoint: { sha: string; baseLabel: string } | null;
	// The commit whose diff is currently open, or null when the History tab is
	// showing the list. Ephemeral — not persisted across launches.
	activeCommit: CommitInfo | null;
	// Whether the super-review skill is installed in the active repo. null
	// while unknown (no active repo, or the check hasn't returned yet); false
	// drives the "Install skill" prompts in the header and sessions empty state.
	skillInstalled: boolean | null;
	// Whether the user dismissed the "Install the skill" notice above the commit
	// box. In-memory only and reset on every repo switch, so it stays hidden while
	// you work in this repo but returns if the skill is still missing next time.
	skillInstallDismissed: boolean;
	// Changeset situation for the active repo's current branch (drives the "Add a
	// changeset?" prompt above the commit box). null while unknown / not the
	// working-tree context.
	changesetStatus: ChangesetStatus | null;
	// Whether the create-changeset dialog is open.
	changesetDialogOpen: boolean;
	// Whether the user dismissed the "Add a changeset?" prompt / the "Some
	// changesets may be unnecessary" warning for the current branch. In-memory only
	// and cleared on every branch switch, so a dismissal lasts only while you stay
	// on the branch.
	changesetPromptDismissed: boolean;
	changesetWarningDismissed: boolean;
	// Whether the "review unnecessary changesets" dialog is open.
	changesetReviewOpen: boolean;
	// User pref (Integrations settings): when false, all changeset behavior is off.
	changesetsEnabled: boolean;
	// User pref: SSH-sign every commit (on by default). See UserPrefs.signCommits.
	signCommits: boolean;
	changedFiles: ChangedFile[];
	// Free-text filter applied to the changed-files list. Shared between the
	// sidebar (where it's typed) and the diff view (which hides sections for
	// files that don't match) so both stay in sync.
	fileSearchQuery: string;
	// Count of working-tree changes, kept in sync regardless of the active tab
	// so the Unstaged tab can always show a badge with the current count.
	unstagedFileCount: number;
	// Ids of repos with a dirty working tree (uncommitted changes), so the repo
	// picker can flag them with a dot. The active repo's entry is kept in step by
	// every file refresh; the rest are recomputed when the picker is opened.
	dirtyRepoIds: SvelteSet<string>;
	selectedFile: string | null;
	// Multi-file selection in the sidebar, driven by cmd/shift-click. Distinct
	// from `selectedFile` (the one file whose diff is open): this set highlights
	// every selected row and is the target of bulk context-menu actions (discard
	// / include / exclude). A plain click or keyboard navigation collapses it
	// back to the single active file.
	selectedFiles: SvelteSet<string>;
	seenFiles: SvelteSet<string>;
	// Whether the "You've seen it all" completion state on the Branch tab has been
	// dismissed via "Keep Reviewing". Transient (never persisted): it's reset the
	// moment the branch drops below fully-seen, so finishing review again re-shows
	// the celebration. See `allBranchChangesSeen()`.
	seenItAllDismissed: boolean;
	// Whether the completion state should animate its entrance. Only set when the
	// user marks the *last* change seen while on the Branch tab (the initial
	// completion); it stays false when simply switching back to an already-finished
	// branch, so the celebration only animates the first time you finish. Reset
	// alongside `seenItAllDismissed` once the branch drops below fully-seen.
	seenItAllAnimate: boolean;
	// Working-tree files explicitly unchecked in the Unstaged tab so they're
	// left out of the next commit. Tracking exclusions (rather than inclusions)
	// means everything is committed by default and newly-changed files show up
	// checked — matching GitHub Desktop. Only meaningful for the working tree.
	excludedFromCommit: SvelteSet<string>;
	// Individual changed lines explicitly unchecked in the Unstaged tab, for
	// partial (line/hunk) staging. Each entry is a key from
	// `stagingLineKey(path, side, lineNumber)`; presence means "leave this line
	// out of the next commit". A file with any such key (and not in
	// `excludedFromCommit`) is partially staged. Working tree only; in-memory and
	// pruned/reset alongside `excludedFromCommit`.
	stagingLineExclusions: SvelteSet<string>;
	collapsedFiles: SvelteSet<string>;
	viewMode: ViewMode;
	// Whether the diff view scrolls through every file at once ('scroll') or
	// shows one file's diff at a time ('single'), switching with the sidebar.
	diffLayout: DiffLayout;
	// File list layout per sidebar tab. The active tab decides which one the
	// sidebar's tree/list toggle reads and writes.
	unstagedFileListLayout: FileListLayout;
	branchFileListLayout: FileListLayout;
	showFileIcons: boolean;
	openFileOnArrowNav: boolean;
	maxDiffLines: number;
	hiddenDiffPatterns: string[];
	customFileIcons: CustomFileIcon[];
	animations: AnimationMode;
	prMergedBehavior: PrMergedBehavior;
	autoRemoveMergedBranch: boolean;
	unmarkSeenOnChange: boolean;
	// How many repos the repo picker's "Recent" section lists (see UserPrefs).
	recentRepoCount: number;
	hotkeys: Hotkeys;
	// Visibility of the optional header controls (sidebar toggles, changeset,
	// editor, terminal), toggled from the header's right-click menu.
	headerItems: HeaderItemVisibility;
	// Visibility of the optional sidebar tabs (Sessions, History), toggled from
	// the tab strip's right-click menu.
	sidebarTabs: SidebarTabVisibility;
	// Initial window bounds, applied on the next launch (see UserPrefs).
	windowWidth: number;
	windowHeight: number;
	startMaximized: boolean;
	theme: 'light' | 'dark';
	// Selected diff code-block theme preset id (see lib/diff-themes).
	diffTheme: string;
	accent: Accent;
	codeFont: string;
	uiFont: string;
	// Font families installed on the user's machine, queried lazily on launch.
	// Empty when the Local Font Access API is unavailable or denied.
	systemFonts: string[];
	prefs: UserPrefs | null;
	githubAccounts: GithubAccount[];
	activeGithubAccount: GithubAccount | null;
	// Accounts whose GitHub token no longer authenticates (revoked, or a SAML
	// session that lapsed). Hydrated at startup and kept live via the
	// github:auth-changed event; drives the "sign in again" prompt.
	githubAuthErrors: GithubAuthError[];
	sidebarCollapsed: boolean;
	collapsedFolders: SvelteSet<string>;
	// A request to scroll the diff view to a file (`path`), a tour step header
	// (`stepId`), or a specific callout (`calloutId`, handled by the owning file
	// section since the note lives inside the diff). The nonce makes repeat
	// requests to the same target fire again.
	scrollRequest: {
		path?: string;
		stepId?: string;
		calloutId?: string;
		nonce: number;
	} | null;
	// The reviewer's current scroll position in the diff view (file at the top of
	// the viewport + offset), tracked live as they scroll. The diff view restores
	// to this whenever the rendered list is rebuilt — a refresh, or returning to
	// this tab — so the view holds its place instead of snapping back to the top.
	scrollAnchor: ScrollAnchor | null;
	lastRefreshAt: number | null;
	fetchingOrigin: boolean;
	nowTick: number;
	platform: AppPlatform;
	editors: Record<EditorKind, boolean>;
	terminals: Record<TerminalKind, boolean>;
	settingsDialogOpen: boolean;
	// When set, SettingsDialog switches to this tab on the next open.
	settingsDialogTab: SettingsTab | null;
	// When set, SettingsDialog scrolls to `settings-<id>` inside the active tab.
	settingsDialogScrollTo: SettingsScrollTarget | null;
	// Bumped when scroll should run while the dialog is already open.
	settingsDialogScrollNonce: number;
	// Whether the per-repo Repository Settings dialog is open (Fork Behavior, …).
	repoSettingsDialogOpen: boolean;
	// Whether the in-app feedback dialog is open (Help ▸ Send Feedback, ⇧⌘/).
	feedbackDialogOpen: boolean;
	// Pre-filled fields for the feedback dialog, set when it's opened from a
	// one-click error report. null when opened normally (blank form).
	feedbackPrefill: FeedbackDraft | null;
	// Cmd/Ctrl+K fuzzy file-search palette. Opened from the header search box or
	// the global shortcut; selecting a file scrolls the diff to it.
	commandMenuOpen: boolean;
	// Bumped to ask the sidebar to focus its file-search input — driven by the
	// global "search files (sidebar)" hotkey, which lives outside FileList.
	focusSidebarSearchNonce: number;
	githubSignIn: GithubSignInState;
	pushStatus: PushStatus | null;
	// Tip commit of the current branch, surfaced so the commit box can offer an
	// "Undo" affordance for the most recent unpushed commit.
	lastCommit: LastCommit | null;
	// PR matching the current branch (if any). Refreshed alongside push status.
	branchPR: PRSummary | null;
	// PR numbers whose base branch tip we've pinned locally to `pr/<n>/base`.
	// The Branch diff targets that ref (so it matches the PR's real base — which
	// may be an upstream/non-default branch — rather than the local default) only
	// once it's in here, otherwise it would reference a ref git can't resolve.
	fetchedPRBases: Set<number>;
	// The non-default base ref the checked-out branch was last diffed against
	// (a `pr/<n>/base`), seeded from disk on a cold start once we've confirmed the
	// ref still exists locally. Lets branchDiffBaseRef target the PR base from the
	// first paint — before the async PR lookup resolves — so the Branch diff's
	// seen-state context key doesn't flip ~1s in. Null when none is remembered.
	rememberedBranchBase: string | null;
	// CI/workflow status for the focused PR's head commit (`activePR ?? branchPR`)
	// — aggregate plus the individual checks for a hover breakdown. The single
	// source the header button AND the Conversation merge box both read, so they
	// never skew. Keyed by PR number so a stale poll can't paint the wrong PR;
	// polled on an interval while a PR is shown.
	prChecks: { number: number; summary: PRChecksSummary } | null;
	// Whether the active account can push commits to `branchPR`'s head branch.
	// null while unknown / not applicable; drives the commit-box warning so it
	// only fires when a push would actually be rejected.
	branchPRPushAccess: boolean | null;
	// Whether the active account can push to the repo's `origin` (the original
	// repo). null while unknown / not applicable (no GitHub remote, no account).
	// false drives the "create a fork" banner and gates commit/push through the
	// fork dialog.
	repoPushAccess: boolean | null;
	// Set when the user is asked to fork (no write access + tried to commit/push,
	// or clicked the banner link). `intent` is the action to resume after the fork
	// is created; `commit` carries the pending commit message when intent ===
	// 'commit'. Drives ForkDialog. Cleared on cancel/confirm.
	forkPrompt: {
		owner: string;
		repo: string;
		intent: 'commit' | 'push';
		commit?: { summary: string; description: string };
	} | null;
	// Set when a checked-out branch's PR is observed transitioning unmerged →
	// merged, driving the "switch back to the default branch?" dialog. Cleared
	// when the user confirms or dismisses. Never set by merely navigating to an
	// already-merged PR — only by a live transition we observed.
	mergedSwitchPrompt: { branch: string; defaultBranch: string; prNumber: number } | null;
	// Set after switching off a merged branch (via dialog or auto-switch) to drive
	// the "remove this branch locally?" dialog. Holds the branch to delete.
	mergedRemovePrompt: { branch: string } | null;
	// Set when a pull is blocked by uncommitted local changes git would overwrite.
	// Drives StashPromptDialog ("Stash Changes and Continue"). `files` is the
	// blocked file list git reported. Cleared on confirm/dismiss.
	stashPrompt: { files: string[] } | null;
	// Set when the user switches to (or has just created) a branch with a dirty
	// working tree, asking what to do with the in-progress work: leave it stashed
	// on the current branch, or bring it over to `target`. Drives
	// SwitchBranchDialog. Cleared on confirm/dismiss and on repo switch.
	switchBranchPrompt: { target: string } | null;
	// The managed stash parked on the current branch (one per branch), or null
	// when there's none. Refreshed alongside files/branches; drives the "Stashed
	// Changes" sidebar row.
	stash: ManagedStash | null;
	// Transient: set while the user is viewing the managed stash (the sidebar
	// list + diff pane swap to the stash's contents). Kept off `contextTab` so it
	// doesn't pollute the persisted tab; closing restores the prior context.
	stashView: { ref: string } | null;
	// PR currently being reviewed (when diffContext.kind === 'pr').
	activePR: PRSummary | null;
	// Review comments for the active PR, indexed by file path.
	prComments: Record<string, PRReviewComment[]>;
	loadingComments: boolean;
	// The active PR's top-level conversation timeline (issue comments, reviews,
	// commits, events), chronological. Drives the Conversation tab. Loaded lazily
	// the first time that tab is shown for a PR; see `prConversationLoadedFor`.
	prConversation: PRConversationItem[];
	loadingConversation: boolean;
	// The PR number `prConversation` was loaded for, so switching to a different PR
	// (or away) knows the cached feed is stale. Null when nothing's loaded.
	prConversationLoadedFor: number | null;
	// Which tab the comments sidebar shows. 'conversation' only renders in a PR
	// context; the panel falls back to 'comments' (local/review comments) otherwise.
	// Ephemeral (per launch).
	commentsSidebarTab: 'comments' | 'conversation';
	// Mergeability for the focused PR (`activePR ?? branchPR`). Checks live in the
	// shared `prChecks` store, not here, so the merge box and header button can't
	// disagree. Fetched on demand when the Conversation panel is shown.
	mergeBox: {
		number: number;
		mergeable: boolean | null;
		mergeableState: string;
	} | null;
	loadingMergeBox: boolean;
	// Set while a merge / ready-for-review action is in flight so the merge box's
	// buttons can disable + spin. Cleared when the action settles.
	mergeBoxBusy: 'merge' | 'ready' | null;
	// Thread collapse overrides, keyed by the root comment id (`pr-<rootId>`).
	// Absence ⇒ use the default (collapsed when the thread is resolved or outdated,
	// expanded otherwise), so resolving a thread auto-collapses it; an explicit
	// entry pins the user's choice. Sidebar "reveal" writes `false` to force open.
	commentCollapse: SvelteMap<string, boolean>;
	// At most one composer can be open per (file,line,side) at a time. Keyed
	// by the same string the renderer uses to scope the annotation.
	pendingComposers: Record<string, PendingComposer>;
	// Local review comments for the active diff context, newest-updated first.
	// Loaded whenever the context changes and kept live via the comments watcher.
	localComments: LocalComment[];
	// The diff-context key `localComments` was loaded for, so a context switch can
	// tell whether the in-memory list (and any open composers) are stale.
	localCommentsContextKey: string | null;
	// Pending local-comment compose boxes, keyed like `pendingComposers`.
	localComposers: Record<string, LocalComposer>;
	// Ids of local comments whose anchored line has fallen out of the current diff
	// — the working tree changed under them, mirroring GitHub's "outdated" flag for
	// PR comments. Maintained by each DiffFileSection for its own file's comments
	// (it owns the parsed diff), so the comments sidebar can badge them even though
	// an orphaned comment no longer renders inline.
	outdatedLocalCommentIds: SvelteSet<string>;
	// Whether the right-hand comments sidebar is open. Ephemeral (per launch).
	commentsSidebarOpen: boolean;
	// When true, the comments panel fills the whole work area (diff pane collapsed
	// to zero). Only enterable while the left sidebar is collapsed.
	conversationFullscreen: boolean;
	// A comment the sidebar asked the diff view to scroll to, bumped on each
	// request so repeated clicks on the same row re-trigger the scroll.
	// A comment the sidebar asked the diff to scroll to. `key` matches the
	// annotation container key in DiffFileSection (a local comment id, or
	// `pr-<id>` for a PR review comment); `path` is the file that owns it. Bumped
	// nonce re-triggers the scroll on repeated clicks.
	commentScrollTarget: { key: string; path: string; nonce: number } | null;
	addRepoDialogOpen: boolean;
	publishDialogOpen: boolean;
	createBranchDialogOpen: boolean;
	// Whether the "Clean Up Local Branches" dialog is open. The dialog itself
	// loads the local-only branch candidates when it opens.
	cleanupBranchesDialogOpen: boolean;
	// The branch the create-branch dialog was opened from, snapshotted on open so
	// the dialog's "based on…" options stay fixed for its lifetime. Creating with
	// checkout switches app.currentBranch to the new branch mid-flow; reading that
	// live would flash the selector visible (current !== default) before close.
	createBranchFrom: string | null;
	push: {
		inProgress: boolean;
		stage:
			| 'idle'
			| 'fetching'
			| 'committing'
			| 'pulling'
			| 'pushing'
			| 'forking'
			| 'conflicts'
			| 'done';
		// 'stash-restore' reuses the conflict dialog + push.stage machinery for a
		// managed-stash pop, but routes continue/abort to the dedicated stash-pop
		// finish/abort paths (a pop has no MERGE_HEAD and makes no commit).
		intent: 'push' | 'pull' | 'stash-restore';
		// The specific user-facing action that owns this operation. `intent` is too
		// coarse for header spinner attribution — pull, update-from-default, and
		// update-from-upstream all share intent 'pull', so a single 'pull' op would
		// light every pull-shaped button at once. `op` maps 1:1 to the button that
		// should spin, so at most one header spinner is ever active for an op.
		op: 'push' | 'pull' | 'update' | 'update-upstream' | 'commit' | 'stash-restore';
		// SHA of the managed stash a conflicted 'stash-restore' pop is finishing.
		// Carried here (not read off `app.stash`) because a bring-to-another-branch
		// pop lands on the target while the kept stash stays marked for the source
		// branch — so `refreshStash` (focus/poll) finds no match for the current
		// branch and nulls `app.stash`, which would otherwise strand continueMerge.
		stashRef?: string | null;
		error: string | null;
	};
	// Every file involved in the current merge conflict. Persists through
	// resolution so the dialog can keep showing each file (with a check once
	// it's resolved). `conflictUnresolved` is the subset still carrying markers.
	conflictFiles: string[];
	conflictUnresolved: string[];
	// Bumped whenever an operation rewrites working-tree files in place (merge,
	// pull, push, update, abort). Diff sections watch it to drop their cached
	// content and re-fetch, since the file can stay in the list while its
	// contents change out from under the cached diff.
	diffReloadToken: number;
	// Bumped on every focus/poll refresh. Unlike diffReloadToken this keeps the
	// cache and the on-screen diff in place: open sections re-fetch in the
	// background and swap only if the file changed on disk. That's how edits made
	// outside the app (another editor, the CLI) get picked up without a flicker.
	diffRevalidateToken: number;
	loading: {
		files: boolean;
		branches: boolean;
		prs: boolean;
		repos: boolean;
	};
	// Active error toasts, newest last. Errors stack instead of overwriting so a
	// new failure never silently replaces one the user hasn't seen yet.
	errors: ErrorToast[];
}

export function composerKey(filePath: string, side: 'LEFT' | 'RIGHT', line: number): string {
	return `${filePath}::${side}::${line}`;
}

// The branch currently shown in the UI: the read-only view target when one is
// set, otherwise the checked-out branch. This is what the picker trigger labels
// and what the Branch diff is computed against.
export function viewedBranch(): string | null {
	return app.viewBranch ?? app.currentBranch;
}

// True when we're reviewing a branch read-only that isn't the checked-out one.
// Branch-specific (used where branch-name semantics matter); for the broad
// "are we in a read-only view" question (which also covers PRs) use
// `isReadOnlyView()`.
export function isViewingOtherBranch(): boolean {
	return app.viewBranch != null && app.viewBranch !== app.currentBranch;
}

// True whenever the UI is showing a read-only view — a branch other than the
// checkout, or a pull request — rather than the checked-out working branch.
// Drives the Unstaged-tab hiding, comment suppression, and the header's
// "checked out elsewhere" hint.
export function isReadOnlyView(): boolean {
	return isViewingOtherBranch() || app.viewPR != null;
}

// Whether a PR comment's *thread* renders collapsed. Collapse is thread-level —
// keyed by the root comment id, so the whole conversation folds under one toggle.
// An explicit user/reveal override wins; otherwise a resolved or outdated thread
// defaults collapsed (low-priority context) while everything else stays open.
export function prThreadCollapsed(c: PRReviewComment): boolean {
	const rootId = c.inReplyTo ?? c.id;
	const root = (app.prComments[c.path] ?? []).find((x) => x.id === rootId) ?? c;
	return app.commentCollapse.get(`pr-${rootId}`) ?? (root.isResolved || root.isOutdated);
}

// True when the diff on screen is a pull request's, so commenting surfaces GitHub
// PR review comments rather than local ones. Mirrors DiffFileSection's gate: a
// `pr` context, or the Branch tab with an open PR for the checked-out branch.
// Drives the Comments sidebar's source (PR comments vs local comments).
export function isPRCommentContext(): boolean {
	return (
		app.diffContext.kind === 'pr' ||
		(app.contextTab === 'branch' && app.branchPR != null && !isReadOnlyView())
	);
}

// The tab the Comments sidebar actually shows. Outside a PR context the
// Conversation tab doesn't exist, so the panel always displays Comments even
// when `commentsSidebarTab` still remembers 'conversation' from a PR view. The
// hotkeys (openCommentsSidebar) must reason about this effective tab, not the
// raw remembered one, or Ctrl+L thinks it's on the Conversation tab and needs a
// second press to close.
export function effectiveCommentsSidebarTab(): 'comments' | 'conversation' {
	return isPRCommentContext() ? app.commentsSidebarTab : 'comments';
}

// Whether the Comments sidebar has UNRESOLVED comments in the current context —
// PR review comments in a PR view, local comments otherwise. Drives the header
// toggle's notification dot, which should only show when there's something left
// to act on (resolved-only threads don't light it).
export function sidebarHasUnresolvedComments(): boolean {
	if (isPRCommentContext()) {
		return Object.values(app.prComments).some((list) =>
			list.some((c) => c.line != null && c.inReplyTo == null && !c.isResolved)
		);
	}
	return app.localComments.some((c) => c.resolvedAt == null);
}

// True when the Branch tab has something to show. The Branch diff compares the
// default branch (base) against the viewed head. On a plain default-branch
// checkout those are identical, so the diff is always empty — hide the tab. A
// read-only view (a PR or another branch) always has head !== base, so the tab
// stays useful there even while the default branch is the one checked out.
export function canViewBranchTab(): boolean {
	if (isReadOnlyView()) return true;
	const base = app.activeRepo?.defaultBranch ?? 'main';
	return app.currentBranch !== base;
}

// True when the Branch tab is showing changes and every one has been marked
// seen. Drives the "You've seen it all" completion state. Scoped to the Branch
// tab on purpose: the Unstaged tab's checkboxes are commit-inclusion, not
// "seen", and the Sessions tab has its own flow.
export function allBranchChangesSeen(): boolean {
	return (
		app.contextTab === 'branch' &&
		app.changedFiles.length > 0 &&
		app.changedFiles.every((f) => app.seenFiles.has(f.path))
	);
}

// A short label for the read-only PR being viewed (its head branch), or null
// when not viewing a PR. The picker trigger shows this in place of a branch.
export function viewedPRLabel(): string | null {
	return app.viewPR?.headRef ?? null;
}

// The PR the header should act on: the one matching whatever's on screen. When
// reviewing a PR read-only that's the viewed PR; when reviewing another branch
// read-only it's that branch's PR (looked up into `viewBranchPR`); otherwise
// it's the checked-out branch's PR. Lets the header's PR button follow the view
// instead of always pointing at the checked-out branch.
export function uiPR(): PRSummary | null {
	if (app.viewPR) return app.viewPR;
	if (isViewingOtherBranch()) return app.viewBranchPR;
	return app.branchPR;
}

// Resolve which PR the comment surface should target.
// - `kind: 'pr'` context: the PR being reviewed (its number lives on the ctx).
// - any other context with a known `branchPR`: comment against that PR. We anchor
//   the comment to the branch tip the diff was rendered from (see
//   `commentAnchorRef`), so when the branch is pushed and in sync with the PR
//   head the comment lands current. If the local branch has commits GitHub hasn't
//   seen yet (unpushed) the line numbers won't align with the PR's diff, and the
//   comment is rejected with an actionable "push your branch" error rather than
//   silently landing outdated.
export function commentablePRNumber(): number | null {
	if (app.diffContext.kind === 'pr') return app.diffContext.prNumber;
	// `branchPR` tracks the checked-out branch; while reviewing a *different*
	// branch or a PR read-only its line numbers wouldn't line up with what's on
	// screen, so don't offer commenting against it.
	if (app.branchPR && !isReadOnlyView()) return app.branchPR.number;
	return null;
}

// Git ref of the commit the on-screen diff was rendered from, used to anchor a
// new review comment to exactly what's visible. Mirrors the head `refsForContext`
// picks: `pr/<n>/head` for a PR view, the branch tip for a Branch view. On the
// Branch tab the branch tip (once pushed) is the PR's live head, so the comment
// isn't born "Outdated"; the old code always anchored to the `pr/<n>/head`
// snapshot, which lags a branch that's had commits pushed since the PR was last
// fetched. Undefined for contexts with no committed head (working tree), where
// the main process falls back to the snapshot then the live head.
function commentAnchorRef(): string | undefined {
	const ctx = app.diffContext;
	if (ctx.kind === 'pr') return `pr/${ctx.prNumber}/head`;
	if (ctx.kind === 'branch') return ctx.head;
	return undefined;
}

// The PR the comment/checks surface currently targets (the one being reviewed,
// or the current branch's PR).
function commentablePR(): PRSummary | null {
	if (app.diffContext.kind === 'pr') return app.activePR;
	if (isReadOnlyView()) return null;
	return app.branchPR;
}

// Host repo (owner, repo) a PR's operations must target — its base repo, which
// for an upstream PR is the parent, not the active fork. Returned as a tuple to
// spread into the host-aware github IPC calls; undefineds fall back server-side
// to the active repo's own coordinates.
function prHostArgs(pr: PRSummary | null): [owner: string | undefined, repo: string | undefined] {
	return [pr?.repoOwner, pr?.repoName];
}

const initial: AppState = {
	repos: [],
	activeRepo: null,
	branches: [],
	currentBranch: null,
	viewBranch: null,
	viewPR: null,
	viewBranchPR: null,
	prs: [],
	prsHasMore: false,
	loadingMorePRs: false,
	prsSource: 'fork',
	diffContext: { kind: 'workingTree' },
	contextTab: 'unstaged',
	sessions: [],
	sessionCount: 0,
	activeSessionId: null,
	activeSessionDetail: null,
	sessionView: 'tour',
	commits: [],
	historyForkPoint: null,
	activeCommit: null,
	skillInstalled: null,
	skillInstallDismissed: false,
	changesetStatus: null,
	changesetDialogOpen: false,
	changesetPromptDismissed: false,
	changesetWarningDismissed: false,
	changesetsEnabled: true,
	signCommits: true,
	changesetReviewOpen: false,
	changedFiles: [],
	fileSearchQuery: '',
	unstagedFileCount: 0,
	dirtyRepoIds: new SvelteSet(),
	selectedFile: null,
	selectedFiles: new SvelteSet(),
	seenFiles: new SvelteSet(),
	seenItAllDismissed: false,
	seenItAllAnimate: false,
	excludedFromCommit: new SvelteSet(),
	stagingLineExclusions: new SvelteSet(),
	collapsedFiles: new SvelteSet(),
	viewMode: 'split',
	diffLayout: 'scroll',
	unstagedFileListLayout: 'tree',
	branchFileListLayout: 'tree',
	showFileIcons: true,
	openFileOnArrowNav: true,
	maxDiffLines: 1500,
	hiddenDiffPatterns: DEFAULT_HIDDEN_DIFF_PATTERNS,
	customFileIcons: [],
	animations: 'accents',
	prMergedBehavior: 'prompt',
	autoRemoveMergedBranch: false,
	unmarkSeenOnChange: true,
	recentRepoCount: 5,
	hotkeys: DEFAULT_HOTKEYS,
	headerItems: { ...DEFAULT_HEADER_ITEMS },
	sidebarTabs: { ...DEFAULT_SIDEBAR_TABS },
	windowWidth: WINDOW_BOUNDS.defaultWidth,
	windowHeight: WINDOW_BOUNDS.defaultHeight,
	startMaximized: false,
	theme: 'dark',
	diffTheme: DEFAULT_DIFF_THEME,
	accent: 'super',
	codeFont: 'system',
	uiFont: 'system',
	systemFonts: [],
	prefs: null,
	githubAccounts: [],
	activeGithubAccount: null,
	githubAuthErrors: [],
	sidebarCollapsed: false,
	collapsedFolders: new SvelteSet(),
	scrollRequest: null,
	scrollAnchor: null,
	lastRefreshAt: null,
	fetchingOrigin: false,
	nowTick: 0,
	platform: 'darwin',
	editors: {
		cursor: false,
		vscode: false,
		zed: false,
		xcode: false,
		visualstudio: false
	},
	terminals: {
		terminal: false,
		iterm: false,
		warp: false,
		ghostty: false,
		cmd: false,
		powershell: false
	},
	settingsDialogOpen: false,
	settingsDialogTab: null,
	settingsDialogScrollTo: null,
	settingsDialogScrollNonce: 0,
	repoSettingsDialogOpen: false,
	feedbackDialogOpen: false,
	feedbackPrefill: null,
	commandMenuOpen: false,
	focusSidebarSearchNonce: 0,
	githubSignIn: {
		open: false,
		userCode: null,
		verificationUri: null,
		polling: false,
		error: null
	},
	pushStatus: null,
	lastCommit: null,
	branchPR: null,
	fetchedPRBases: new Set<number>(),
	rememberedBranchBase: null,
	prChecks: null,
	branchPRPushAccess: null,
	repoPushAccess: null,
	forkPrompt: null,
	mergedSwitchPrompt: null,
	mergedRemovePrompt: null,
	stashPrompt: null,
	switchBranchPrompt: null,
	stash: null,
	stashView: null,
	activePR: null,
	prComments: {},
	loadingComments: false,
	prConversation: [],
	loadingConversation: false,
	prConversationLoadedFor: null,
	commentsSidebarTab: 'comments',
	mergeBox: null,
	loadingMergeBox: false,
	mergeBoxBusy: null,
	commentCollapse: new SvelteMap(),
	pendingComposers: {},
	localComments: [],
	localCommentsContextKey: null,
	localComposers: {},
	outdatedLocalCommentIds: new SvelteSet(),
	commentsSidebarOpen: false,
	conversationFullscreen: false,
	commentScrollTarget: null,
	addRepoDialogOpen: false,
	publishDialogOpen: false,
	createBranchDialogOpen: false,
	cleanupBranchesDialogOpen: false,
	createBranchFrom: null,
	push: { inProgress: false, stage: 'idle', intent: 'push', op: 'push', error: null },
	conflictFiles: [],
	conflictUnresolved: [],
	diffReloadToken: 0,
	diffRevalidateToken: 0,
	loading: { files: false, branches: false, prs: false, repos: false },
	errors: []
};

export const app = $state<AppState>(initial);

// Must match the per-page size the main process requests; a short page tells us
// we've reached the end and there's nothing more to load.
const PR_PAGE_SIZE = 30;
// Last PR page successfully loaded for the active repo (0 = none yet).
let prsPage = 0;

// The source the PR list defaults to: a fork's upstream when one is known,
// otherwise the repo's own remote.
function defaultPRSource(repo: RepoInfo | null): PRSource {
	return repo?.upstreamOwner && repo.upstreamRepo ? 'upstream' : 'fork';
}

// The GitHub repo that "View on GitHub" / "Create Issue" should target: the
// upstream parent for a fork contributing to it, otherwise the repo's own remote.
// null when there's no GitHub remote.
function githubHostRepo(): { owner: string; repo: string } | null {
	const repo = app.activeRepo;
	if (repo?.upstreamOwner && repo.upstreamRepo) {
		return { owner: repo.upstreamOwner, repo: repo.upstreamRepo };
	}
	if (repo?.githubOwner && repo.githubRepo) {
		return { owner: repo.githubOwner, repo: repo.githubRepo };
	}
	return null;
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
		app.prsSource = prsSourceByRepo.get(app.activeRepo.id) ?? defaultPRSource(app.activeRepo);
	}
}

function filesCacheKey(repoId: string, ctx: DiffContext): string {
	return `${repoId}::${diffContextKey(ctx)}`;
}

// A fingerprint of a changed file's content, captured when the file is marked
// seen and re-checked on every refresh. When it changes — new commits pushed to a
// branch, or further working-tree edits — the seen mark is cleared so the file
// resurfaces (gated by the unmarkSeenOnChange pref). Prefer the content signature
// git supplies (the destination blob OID, or the worktree blob hash from the diff
// patch), which moves on any real edit — even one that keeps the same +/- counts.
// Fall back to the stat-based signature when git couldn't supply one (e.g. a
// deleted file, or older cached data) so the behavior degrades rather than breaks.
function fileContentSig(f: ChangedFile): string {
	if (f.contentSig) return `oid:${f.contentSig}`;
	return `${f.status}:${f.additions}:${f.deletions}:${f.isBinary ? 'b' : 't'}`;
}

// Whether two signatures describe content the same way, so a difference between
// them actually means the content changed. `fileContentSig` emits an `oid:`
// signature when git supplied a blob OID and a stat-based one otherwise — and a
// single failed/empty git diff (e.g. transient index.lock contention) drops the
// OID for *every* file in the list at once, flipping all of them to the stat
// scheme. Comparing across schemes would read that flip as "everything changed"
// and wrongly clear every seen mark, so only compare like with like.
function sigsComparable(a: string, b: string): boolean {
	return a.startsWith('oid:') === b.startsWith('oid:');
}

// Paint the file list from the per-context cache for the current diff context,
// if we've shown it before. Makes a context switch feel instant — the previous
// content shows immediately while `refreshFiles` revalidates in the background.
// Returns whether a cached list was found: on a miss the caller should clear the
// stale list and show a loading state rather than leaving the old diff on screen.
function hydrateFilesFromCache(): boolean {
	if (!app.activeRepo) return false;
	const cached = filesCache.get(
		filesCacheKey(app.activeRepo.id, $state.snapshot(app.diffContext) as DiffContext)
	);
	if (!cached) return false;
	app.changedFiles = cached.changedFiles;
	app.seenFiles = new SvelteSet(cached.seenFiles);
	app.collapsedFiles = new SvelteSet(cached.collapsedFiles);
	app.selectedFile = cached.selectedFile;
	app.scrollAnchor = cached.scrollAnchor ?? null;
	return true;
}

// Drop the on-screen file list and flip the loading flag so the diff view shows
// its "Loading…" state immediately, rather than leaving the previous context's
// diff visible (which reads as a frozen UI) while a fresh list is fetched.
function showLoadingFiles(): void {
	app.changedFiles = [];
	app.selectedFile = null;
	// New context being loaded cold — there's no place to hold, so don't let a
	// previous context's anchor pull the fresh diff somewhere on first paint.
	app.scrollAnchor = null;
	app.loading.files = true;
}

function diffCacheKeyFor(repoId: string, ctx: DiffContext, filePath: string): string {
	return `${repoId}::${diffContextKey(ctx)}::${filePath}`;
}

// Extract the file path from a staging line-exclusion key (`${path}<NUL>…`).
function pathFromLineKey(key: string): string {
	const i = key.indexOf('\u0000');
	return i === -1 ? key : key.slice(0, i);
}

// Drop every per-line staging exclusion belonging to the given files. Used when
// a whole-file toggle takes over and should override any partial selection.
function clearFileLineExclusions(paths: Iterable<string>): void {
	const set = new Set(paths);
	for (const k of [...app.stagingLineExclusions]) {
		if (set.has(pathFromLineKey(k))) app.stagingLineExclusions.delete(k);
	}
}

// Turn the checked working-tree files into the per-file selections the commit
// IPC expects. A file with no per-line exclusions commits whole; one with
// exclusions gets a reduced patch built from its current diff (re-fetched when
// not cached, so the patch is always valid against the live HEAD). A stale
// exclusion that no longer matches any line is simply ignored by the builder,
// so a partial commit can never apply changes that aren't really there. Files
// whose every change is excluded drop out entirely.
async function buildCommitSelections(
	repoId: string,
	ctx: DiffContext,
	included: ChangedFile[]
): Promise<CommitFileSelection[]> {
	const selections: CommitFileSelection[] = [];
	for (const f of included) {
		// Plain Sets — local scratch handed to buildFilteredPatch, not reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const excludedAdds = new Set<number>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const excludedDels = new Set<number>();
		for (const k of app.stagingLineExclusions) {
			if (pathFromLineKey(k) !== f.path) continue;
			// Tail after `${path}<NUL>` is a side marker ('a'/'d') plus a line number.
			const tail = k.slice(f.path.length + 1);
			const n = Number(tail.slice(1));
			if (Number.isNaN(n)) continue;
			if (tail[0] === 'a') excludedAdds.add(n);
			else if (tail[0] === 'd') excludedDels.add(n);
		}
		if (excludedAdds.size === 0 && excludedDels.size === 0) {
			selections.push({ path: f.path, oldPath: f.oldPath });
			continue;
		}
		let diff = getCachedDiff(repoId, ctx, f.path);
		if (!diff) {
			diff = await window.api.git.getDiff(repoId, f.path, ctx).catch(() => undefined);
		}
		const parsed = diff?.patch ? parseFilePatch(diff.patch) : null;
		if (!parsed) {
			// Nothing to filter (e.g. an untracked file with no git patch) — commit
			// the whole file rather than silently dropping it.
			selections.push({ path: f.path, oldPath: f.oldPath });
			continue;
		}
		const patch = buildFilteredPatch(parsed, excludedAdds, excludedDels);
		// `null` means every change was excluded; leave the file out of the commit.
		if (patch != null) selections.push({ path: f.path, oldPath: f.oldPath, patch });
	}
	return selections;
}

export function getCachedDiff(
	repoId: string,
	ctx: DiffContext,
	filePath: string
): DiffData | undefined {
	return diffCache.get(diffCacheKeyFor(repoId, ctx, filePath));
}

export function setCachedDiff(
	repoId: string,
	ctx: DiffContext,
	filePath: string,
	data: DiffData
): void {
	diffCache.set(diffCacheKeyFor(repoId, ctx, filePath), data);
}

// Snapshot of where the user is in the app, attached to every error toast so a
// one-click report can describe what was happening. `action` is the operation
// in flight, passed by the caller when known.
function captureErrorContext(action?: string): ErrorContext {
	const tab = app.contextTab;
	let location: string | undefined;
	if (tab === 'sessions' && app.activeSessionId) {
		location = `session ${app.activeSessionId}`;
	} else if (tab === 'history' && app.activeCommit) {
		location = `commit ${app.activeCommit.hash.slice(0, 7)}`;
	} else if (tab === 'branch' && app.branchPR) {
		location = `PR #${app.branchPR.number}`;
	}
	return {
		action,
		tab,
		repo: app.activeRepo?.name,
		branch: app.currentBranch ?? undefined,
		location
	};
}

let errorSeq = 0;

// Surface an error to the user. Passing a message appends a new toast (errors
// stack rather than overwrite); passing null clears the whole stack. `action`
// names the operation that failed so the toast's one-click report can include
// it. A message identical to the newest toast doesn't pile up a duplicate —
// instead it bumps that toast's count and `bump` nonce, so the UI can flag the
// repeat (a "×N" badge + a shake) rather than leaving the user unsure whether
// the new error registered.
export function setError(msg: string | null, action?: string): void {
	if (msg === null) {
		app.errors = [];
		return;
	}
	const last = app.errors[app.errors.length - 1];
	if (last && last.message === msg) {
		last.count += 1;
		last.bump += 1;
		return;
	}
	app.errors = [
		...app.errors,
		{
			id: `err-${++errorSeq}`,
			message: msg,
			context: captureErrorContext(action),
			count: 1,
			bump: 0
		}
	];
}

// Dismiss a single error toast by id, leaving the rest of the stack in place.
export function dismissError(id: string): void {
	app.errors = app.errors.filter((e) => e.id !== id);
}

// Build a pre-filled feedback report from an error toast: a bug report whose
// body carries the raw error plus the captured context so an agent has the
// "what action / where in the app" detail the issue asks for.
function feedbackDraftFromError(toast: ErrorToast): FeedbackDraft {
	const ctx = toast.context;
	const firstLine = toast.message.split('\n')[0].trim().slice(0, 100);
	const lines = [
		'An error occurred in the app.',
		'',
		'**Error:**',
		'```',
		toast.message,
		'```',
		''
	];
	const ctxLines: string[] = [];
	if (ctx?.action) ctxLines.push(`- Action: ${ctx.action}`);
	if (ctx?.tab) ctxLines.push(`- Tab: ${ctx.tab}`);
	if (ctx?.repo) ctxLines.push(`- Repo: ${ctx.repo}`);
	if (ctx?.branch) ctxLines.push(`- Branch: ${ctx.branch}`);
	if (ctx?.location) ctxLines.push(`- Location: ${ctx.location}`);
	if (ctxLines.length > 0) {
		lines.push('**Context:**', ...ctxLines, '');
	}
	lines.push('_Reported in one click from an error toast. Please add anything else you remember._');
	return {
		category: 'bug',
		title: ctx?.action ? `Error while ${ctx.action.toLowerCase()}` : `Error: ${firstLine}`,
		body: lines.join('\n')
	};
}

// Open the conflict dialog on `files`. Both the full list (shown per-row) and
// the unresolved subset start equal; recheckConflicts narrows the latter as the
// user resolves markers.
function setConflicts(files: string[]): void {
	app.conflictFiles = files;
	app.conflictUnresolved = files;
}

function clearConflicts(): void {
	app.conflictFiles = [];
	app.conflictUnresolved = [];
}

// Force open diff sections to re-fetch: drop the cross-tab diff cache (so a
// re-fetch isn't short-circuited by stale content) and bump the token the
// sections watch. Call after any op that rewrites working-tree files in place.
function bumpDiffReload(): void {
	diffCache.clear();
	app.diffReloadToken++;
}

// Ask open diff sections to silently re-validate against disk. Unlike
// bumpDiffReload this leaves the cache and the rendered diff untouched — the
// sections background-fetch and swap only when the content actually changed —
// so it's cheap enough to call on every focus/poll refresh to catch edits made
// outside the app.
function bumpDiffRevalidate(): void {
	app.diffRevalidateToken++;
}

function applyTheme(theme: 'light' | 'dark'): void {
	const root = document.documentElement;
	root.classList.toggle('dark', theme === 'dark');
	root.classList.toggle('light', theme === 'light');
}

// Push the selected diff theme's `{ dark, light }` pair onto the shared worker
// pool. The pool re-tokenizes every live diff with the new pair and notifies its
// subscribed FileDiff instances (they re-render), while each diff's `themeType`
// keeps flipping light/dark in CSS. No-ops until the pool exists; the App boots
// it before prefs load, and applyDiffTheme runs again right after prefs land.
function applyDiffTheme(): void {
	// `setRenderOptions` replaces the pool's whole render-options bag and defaults
	// every field it isn't handed, so re-pass the options that must persist
	// (char-level diffs + the `data-char` token offsets the hover cards need) —
	// otherwise a theme swap silently resets them. See POOL_PERSISTENT_RENDER_OPTIONS.
	void getDiffWorkerPool()?.setRenderOptions({
		theme: diffThemePair(app.diffTheme),
		...POOL_PERSISTENT_RENDER_OPTIONS
	});
}

// Accent palette. Each accent maps to an `.accent-*` class that overrides the
// primary/ring/sidebar theme variables (see app.css). 'super' (the default
// flame) needs no class — its values are the app.css defaults — but we still
// add `accent-super` so swapping accents is a simple add/remove.
const ACCENT_CLASSES = ['accent-super', 'accent-mono'];
function applyAccent(accent: Accent): void {
	const root = document.documentElement;
	root.classList.remove(...ACCENT_CLASSES);
	root.classList.add(`accent-${accent}`);
}

// Built-in fallback stacks — kept in sync with the defaults in app.css. A
// chosen family is layered on top so missing glyphs still fall back sensibly.
const UI_FONT_STACK =
	"ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const CODE_FONT_STACK = "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace";

export function uiFontCss(font: string | null | undefined): string {
	if (!font || font === 'system') return UI_FONT_STACK;
	return `"${font}", ${UI_FONT_STACK}`;
}

export function codeFontCss(font: string | null | undefined): string {
	if (!font || font === 'system') return CODE_FONT_STACK;
	return `"${font}", ${CODE_FONT_STACK}`;
}

function applyFonts(): void {
	const root = document.documentElement;
	root.style.setProperty('--ui-font', uiFontCss(app.uiFont));
	root.style.setProperty('--code-font', codeFontCss(app.codeFont));
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
	if (typeof query !== 'function') return;
	try {
		const fonts = await query();
		const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
		app.systemFonts = families;
	} catch {
		// Unsupported or permission denied — leave the list empty.
	}
}

// Human-readable names for each editor, shown in menus ("Open in <editor>").
export const EDITOR_LABELS: Record<EditorKind, string> = {
	cursor: 'Cursor',
	vscode: 'Visual Studio Code',
	zed: 'Zed',
	xcode: 'Xcode',
	visualstudio: 'Visual Studio'
};

// Human-readable names for each terminal, shown in menus ("Open in <terminal>").
export const TERMINAL_LABELS: Record<TerminalKind, string> = {
	terminal: 'Terminal',
	iterm: 'iTerm',
	warp: 'Warp',
	ghostty: 'Ghostty',
	cmd: 'Command Prompt',
	powershell: 'PowerShell'
};

// Editor the user has configured, falling back to whichever is detected.
// Returns null when nothing is available.
export function effectiveEditor(): EditorKind | null {
	const pref = app.prefs?.externalEditor ?? null;
	if (pref && app.editors[pref]) return pref;
	if (app.editors.cursor) return 'cursor';
	if (app.editors.vscode) return 'vscode';
	return null;
}

// Terminal the user has configured, falling back to whichever is detected.
const TERMINAL_FALLBACK_ORDER: TerminalKind[] = [
	'ghostty',
	'warp',
	'iterm',
	'terminal',
	'powershell',
	'cmd'
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

// Auth failure (revoked token / lapsed SAML session) for the account the active
// project authenticates as, if any — drives the "sign in again" prompt.
export function effectiveAccountAuthError(): GithubAuthError | null {
	const account = effectiveGithubAccount();
	if (!account) return null;
	return app.githubAuthErrors.find((e) => e.accountId === account.id) ?? null;
}

async function refreshGithubAccounts(): Promise<void> {
	const [accounts, active] = await Promise.all([
		window.api.github.listAccounts(),
		window.api.github.getActiveAccount()
	]);
	app.githubAccounts = accounts;
	app.activeGithubAccount = active;
}

// Bumped every time a sign-in flow starts or is cancelled. The running flow
// captures the value at its start and bails the moment it changes, so a
// cancel (dialog closed) or a fresh start cleanly aborts the in-flight poll
// loop without it racing ahead and reopening the dialog or stomping state.
let githubSignInRunToken = 0;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Drive the GitHub device-flow sign-in from start to finish as one awaited
// sequence: kick off the flow, show the user code, poll until GitHub reports
// success or error, then on success refresh accounts/PRs and close the dialog.
// Driving this explicitly (rather than from a reactive $effect on the dialog's
// open state) means there's no window where resetting the display state can
// re-trigger the flow — which previously opened a duplicate verification tab.
async function startGithubSignInFlow(): Promise<void> {
	const s = app.githubSignIn;
	// A flow is already running — just make sure its dialog is visible.
	if (s.polling) {
		s.open = true;
		return;
	}
	const runToken = ++githubSignInRunToken;
	s.open = true;
	s.error = null;
	s.userCode = null;
	s.verificationUri = null;
	s.polling = true;
	try {
		const flow = await window.api.github.startDeviceFlow();
		if (runToken !== githubSignInRunToken) return; // cancelled while starting
		s.userCode = flow.userCode;
		s.verificationUri = flow.verificationUri;
		for (;;) {
			await delay(1500);
			if (runToken !== githubSignInRunToken) return; // cancelled
			const status = await window.api.github.pollDeviceFlow();
			if (runToken !== githubSignInRunToken) return; // cancelled
			if (status.state === 'success') {
				s.polling = false;
				s.userCode = null;
				s.verificationUri = null;
				s.open = false;
				await refreshGithubAccounts();
				if (app.activeRepo?.githubOwner && app.activeRepo.githubRepo) {
					void actions.loadPRs();
				}
				return;
			}
			if (status.state === 'error') {
				s.polling = false;
				s.error = status.message;
				return;
			}
		}
	} catch (err) {
		if (runToken !== githubSignInRunToken) return;
		s.polling = false;
		s.error = err instanceof Error ? err.message : String(err);
	}
}

async function refreshRepos(): Promise<void> {
	app.loading.repos = true;
	try {
		app.repos = await window.api.repos.list();
	} finally {
		app.loading.repos = false;
	}
}

// Make `repo` the active repo and load everything its view needs. Shared by the
// open/create flows so they land the user in an identical, fully-refreshed state.
async function activateRepo(repo: RepoInfo): Promise<void> {
	// Remember the outgoing repo's layout, then land the freshly opened repo on
	// its own remembered layout (or a clean default) rather than inheriting the
	// previous repo's open panel / fullscreen.
	rememberViewLayout();
	app.activeRepo = repo;
	applyRepoViewLayout(repo.id);
	repoFrecency.use(repo.id);
	// Kick off the local skill check immediately — it only needs activeRepo and is
	// a single filesystem stat, so don't strand it behind the slow network work below.
	void refreshSkillInstalled();
	applyContextTab('unstaged');
	app.diffContext = { kind: 'workingTree' };
	// A read-only view (branch or PR) belongs to the previous repo — drop it.
	app.viewBranch = null;
	app.viewPR = null;
	// Drop the previous repo's view immediately so its file list / diff don't
	// linger on screen while the new repo's data loads in.
	app.changedFiles = [];
	app.selectedFile = null;
	app.selectedFiles = new SvelteSet();
	app.excludedFromCommit = new SvelteSet();
	app.stagingLineExclusions = new SvelteSet();
	app.activeSessionId = null;
	app.activeSessionDetail = null;
	app.sessions = [];
	app.sessionCount = 0;
	app.branchPR = null;
	app.rememberedBranchBase = null;
	app.switchBranchPrompt = null;
	await Promise.all([refreshRepos(), refreshBranches(), refreshFiles(), refreshPushStatus()]);
	// Seed the remembered Branch base now (refreshBranches just resolved
	// currentBranch) so it's ready before the user opens the Branch tab, ahead of
	// the slow network PR lookup below.
	await hydrateRememberedBranchBase();
	await refreshBranchPR();
}

async function refreshBranches(): Promise<void> {
	if (!app.activeRepo) return;
	app.loading.branches = true;
	try {
		app.branches = await window.api.git.listBranches(app.activeRepo.id);
		const prevBranch = app.currentBranch;
		app.currentBranch = await window.api.git.getCurrentBranch(app.activeRepo.id);
		// A changeset prompt/warning dismissal only lasts while you stay on the branch
		// you dismissed it on — switching branches brings it back.
		if (app.currentBranch !== prevBranch) {
			app.changesetPromptDismissed = false;
			app.changesetWarningDismissed = false;
			// New checked-out branch → re-seed its remembered Branch base so the diff
			// targets the right PR base without waiting on the network PR lookup.
			void hydrateRememberedBranchBase();
		}
		// The managed stash is keyed by the current branch, so a branch/repo switch
		// (which always refreshes branches) should re-resolve it. Fire-and-forget —
		// the sidebar row is non-critical and shouldn't block the branch refresh.
		void refreshStash();
	} catch (err) {
		setError(err instanceof Error ? err.message : String(err));
	} finally {
		app.loading.branches = false;
	}
}

// Resolve the managed stash parked on the current branch (one per branch) for
// the "Stashed Changes" sidebar row. A missing stash clears the row; on the
// stash view, a vanished stash (e.g. dropped elsewhere) also closes the view.
async function refreshStash(): Promise<void> {
	if (!app.activeRepo) {
		app.stash = null;
		return;
	}
	try {
		const found = await window.api.git.findManagedStash(app.activeRepo.id);
		app.stash = found;
		if (!found && app.stashView) {
			app.stashView = null;
			app.diffContext = contextForTab(app.contextTab);
		}
	} catch {
		// Non-critical — keep whatever we last knew rather than throwing a banner.
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
			window.api.git.getLastCommit(repoId)
		]);
		app.pushStatus = status;
		app.lastCommit = lastCommit;
	} catch {
		app.pushStatus = null;
		app.lastCommit = null;
	}
}

// The open (unmerged) PR we last observed for a branch in a repo. Used to detect
// a live unmerged → merged transition: we only ever prompt the user to switch
// back to the default branch when a PR we *watched open* becomes merged — never
// when an already-merged PR is simply navigated to. Session-scoped on purpose.
let watchedOpenPR: { repoId: string; branch: string; number: number } | null = null;

// Compare the freshly-resolved `app.branchPR` against the PR we were watching for
// this branch and fire the merged-branch flow on an unmerged → merged transition.
// `findPRForBranch` only returns *open* PRs, so a merge usually surfaces as the PR
// disappearing (null) — we confirm via a direct lookup before acting.
async function detectBranchPRMerge(
	repoId: string,
	branch: string,
	defaultBranch: string
): Promise<void> {
	const pr = app.branchPR;
	const watching =
		watchedOpenPR && watchedOpenPR.repoId === repoId && watchedOpenPR.branch === branch
			? watchedOpenPR
			: null;

	// Still an open, unmerged PR — (re)arm the watcher and we're done.
	if (pr && !pr.merged) {
		watchedOpenPR = { repoId, branch, number: pr.number };
		return;
	}

	// We never saw this branch's PR open in this session, so any merged state is
	// pre-existing (navigated-to), not a transition we should react to.
	if (!watching) return;

	// The watched PR is gone or now reports merged. Confirm the merge before
	// disarming so a transient lookup miss doesn't silently drop the watch.
	let merged = pr?.merged === true && pr.number === watching.number;
	if (!pr) {
		try {
			const full = await window.api.github.getPR(repoId, watching.number);
			merged = full?.merged === true;
		} catch {
			// Couldn't confirm — keep watching and retry on the next refresh.
			return;
		}
	}
	if (!merged) {
		// PR closed without merging (or replaced by a different one) — stop
		// watching, but don't prompt. Only merges trigger the switch-back flow.
		watchedOpenPR = null;
		return;
	}
	watchedOpenPR = null;
	await onBranchPRMerged(branch, watching.number, defaultBranch);
}

// A watched branch's PR just merged. Either switch back to the default branch
// automatically (when the user opted in) or open the confirmation dialog.
async function onBranchPRMerged(
	branch: string,
	prNumber: number,
	defaultBranch: string
): Promise<void> {
	// Only relevant while we're actually sitting on the merged branch and there's
	// a different default branch to return to.
	if (!app.currentBranch || app.currentBranch !== branch || branch === defaultBranch) return;
	if (app.prMergedBehavior === 'nothing') return;
	if (app.prMergedBehavior === 'switch') {
		await performSwitchBackAfterMerge(branch, defaultBranch);
	} else {
		app.mergedSwitchPrompt = { branch, defaultBranch, prNumber };
	}
}

// Switch the working tree off the merged branch back to the default branch, then
// hand off to the remove-branch step (auto-delete or prompt). Shared by the
// auto-switch path and the switch-back dialog's confirm.
async function performSwitchBackAfterMerge(branch: string, defaultBranch: string): Promise<void> {
	const switched = await actions.checkoutBranch(defaultBranch);
	if (!switched) return;
	if (app.autoRemoveMergedBranch) {
		await actions.deleteBranch(branch, { deleteRemote: false });
	} else {
		app.mergedRemovePrompt = { branch };
	}
}

// Pin a PR's base branch tip to `pr/<n>/base` (via fetchPR, which targets the
// PR's own base repo — the upstream parent for a fork PR) so the Branch diff can
// resolve against it. Records the number in `fetchedPRBases` so branchDiffBaseRef
// only switches the base once the ref actually exists. Best-effort and idempotent.
// Returns true when the base is (now) pinned.
async function ensurePRBasePinned(pr: PRSummary | null): Promise<boolean> {
	if (!app.activeRepo || !pr) return false;
	if (app.fetchedPRBases.has(pr.number)) return true;
	try {
		await window.api.github.fetchPR(app.activeRepo.id, pr.number, ...prHostArgs(pr));
		app.fetchedPRBases.add(pr.number);
		return true;
	} catch {
		return false;
	}
}

// Look up the open PR (if any) for the current branch. Only meaningful when
// the repo has a GitHub remote and the user is signed in. Failures are silent
// — the primary action button just falls back to "Create PR".
async function refreshBranchPR(): Promise<void> {
	// Resolve write-access to the repo's origin (drives the fork banner/dialog).
	// Independent of the branch-PR prerequisites below, so kick it off first.
	void refreshRepoPushAccess();
	if (
		!app.activeRepo ||
		!app.activeRepo.githubOwner ||
		!app.activeRepo.githubRepo ||
		!app.activeGithubAccount ||
		!app.currentBranch
	) {
		console.log('[branchPR] skipped — missing prerequisite:', {
			hasActiveRepo: !!app.activeRepo,
			githubOwner: app.activeRepo?.githubOwner ?? null,
			githubRepo: app.activeRepo?.githubRepo ?? null,
			pinnedAccountId: app.activeRepo?.githubAccountId ?? null,
			activeGithubAccount: app.activeGithubAccount?.login ?? null,
			currentBranch: app.currentBranch ?? null
		});
		app.branchPR = null;
		app.branchPRPushAccess = null;
		return;
	}
	console.log(
		`[branchPR] checking ${app.activeRepo.githubOwner}/${app.activeRepo.githubRepo} ` +
			`branch=${app.currentBranch} ` +
			`pinnedAccountId=${app.activeRepo.githubAccountId ?? '(none → app default)'} ` +
			`appDefault=${app.activeGithubAccount.login}`
	);
	const prev = app.branchPR?.number ?? null;
	try {
		app.branchPR = await window.api.github.findPRForBranch(app.activeRepo.id, app.currentBranch);
		console.log(
			`[branchPR] result: ${app.branchPR ? `PR #${app.branchPR.number}` : 'none (will show Create PR)'}`
		);
	} catch (err) {
		console.error('[branchPR] lookup threw:', err);
		app.branchPR = null;
	}
	// Detect an unmerged → merged transition for this branch and, if so, offer to
	// switch back to the default branch. Runs off the just-resolved `app.branchPR`.
	await detectBranchPRMerge(
		app.activeRepo.id,
		app.currentBranch,
		app.activeRepo.defaultBranch ?? 'main'
	);
	// Keep PR-comment state in sync with the branch tab's PR. Only refetch when
	// we're not in `kind: 'pr'` mode (that flow drives its own fetch already).
	if (app.diffContext.kind !== 'pr') {
		const next = app.branchPR?.number ?? null;
		if (next == null) {
			app.prComments = {};
			app.pendingComposers = {};
		} else if (next !== prev) {
			void actions.refreshPRComments();
		}
	}
	// Pin the PR's base branch tip so the Branch diff targets the PR's real base
	// (which may be an upstream/non-default branch) instead of the local default.
	// If this newly pinned the base while the Branch tab is showing the checked-out
	// branch, recompute the context and reload so the diff switches to the correct
	// base — otherwise the diff would keep surfacing files/lines GitHub doesn't
	// consider part of the PR, and comments on them would fail to resolve.
	if (app.branchPR && !app.fetchedPRBases.has(app.branchPR.number)) {
		const pinned = await ensurePRBasePinned(app.branchPR);
		if (pinned && app.contextTab === 'branch' && !isReadOnlyView()) {
			app.diffContext = contextForTab('branch');
			await refreshFiles();
		}
	}
	// Drop any status for a PR we're no longer showing, then refresh.
	if (app.prChecks && app.prChecks.number !== mergeBoxPR()?.number) {
		app.prChecks = null;
	}
	await refreshPrChecks();
	void refreshBranchPRPushAccess();
}

// Look up the open PR for a read-only *viewed* branch — the analogue of
// refreshBranchPR for the checked-out branch — so the header's PR button can
// follow the view. Best-effort and guarded: a slow result that lands after the
// user switched away (or off the read-only view) is dropped.
async function resolveViewBranchPR(branch: string): Promise<void> {
	const repo = app.activeRepo;
	if (!repo || !repo.githubOwner || !repo.githubRepo || !app.activeGithubAccount) return;
	const repoId = repo.id;
	try {
		const pr = await window.api.github.findPRForBranch(repoId, branch);
		if (app.activeRepo?.id !== repoId || app.viewBranch !== branch) return;
		app.viewBranchPR = pr;
		// Pin the PR's base so the viewed branch diffs against the PR's real base
		// (an upstream/non-default branch) rather than the local default. Refresh
		// the diff once it lands if we're still on this view.
		if (pr && (await ensurePRBasePinned(pr))) {
			if (app.viewBranch === branch && app.contextTab === 'branch') {
				app.diffContext = contextForTab('branch');
				await refreshFiles();
			}
		}
	} catch {
		// Best-effort — leave it unresolved (button just won't show a PR).
	}
}

// Poll the CI/workflow status for the focused PR's head commit (`activePR ??
// branchPR`) — the single fetch that feeds both the header button and the
// Conversation merge box. Cheap and failure-silent: the button just hides the
// indicator on error or when nothing reports. Called after `refreshBranchPR`,
// when the Conversation panel opens, and on a timer.
async function refreshPrChecks(): Promise<void> {
	const pr = mergeBoxPR();
	if (!app.activeRepo || !pr) {
		app.prChecks = null;
		return;
	}
	try {
		const summary = await window.api.github.getChecks(
			app.activeRepo.id,
			pr.headSha,
			...prHostArgs(pr)
		);
		// The focused PR may have changed while the request was in flight; only
		// apply the result if it still matches what we're showing.
		if (mergeBoxPR()?.number === pr.number) {
			app.prChecks = { number: pr.number, summary };
		}
	} catch (err) {
		console.error('[prChecks] checks lookup threw:', err);
	}
}

// The PR the Conversation tab's merge box acts on — the one reviewed in a PR
// context, else the checked-out branch's PR. Mirrors ConversationPanel's own
// `pr = activePR ?? branchPR`.
function mergeBoxPR(): PRSummary | null {
	return app.activePR ?? app.branchPR;
}

// Fold a freshly-fetched PR's status fields back into whichever summaries hold
// it (activePR and/or branchPR), so the header pill and merge box reflect
// reality without a full reload. Leaves `body` alone — it's edited through its
// own optimistic flow and a refetch here could clobber an in-progress edit.
function applyPRStatus(full: PRSummary): void {
	const patch = {
		title: full.title,
		state: full.state,
		draft: full.draft,
		merged: full.merged,
		mergeable: full.mergeable,
		mergeableState: full.mergeableState
	};
	if (app.activePR && app.activePR.number === full.number) {
		app.activePR = { ...app.activePR, ...patch };
	}
	if (app.branchPR && app.branchPR.number === full.number) {
		app.branchPR = { ...app.branchPR, ...patch };
	}
}

// PR number we've already scheduled a single mergeability re-poll for, so an
// "unknown" (still-computing) result retries once rather than looping forever.
let mergeBoxRetriedFor: number | null = null;

// Fetch mergeability (single-PR endpoint) for the merge box's PR, then fold the
// fresh status back into the PR summaries. CI checks come from the shared
// `prChecks` store (refreshed in parallel here so opening the panel doesn't wait
// a poll cycle), not from here. Guarded against a stale result landing after the
// user switched PRs. Failure-silent — the box just shows whatever it last had.
async function refreshMergeBox(): Promise<void> {
	const pr = mergeBoxPR();
	if (!app.activeRepo || !pr) {
		app.mergeBox = null;
		return;
	}
	const repoId = app.activeRepo.id;
	app.loadingMergeBox = true;
	// Keep the shared checks store in lockstep with the merge box so the panel's
	// CI rows are current the moment it opens.
	void refreshPrChecks();
	try {
		const full = await window.api.github.getPR(repoId, pr.number, ...prHostArgs(pr));
		// Bail if the panel's PR changed while the request was in flight.
		const cur = mergeBoxPR();
		if (app.activeRepo?.id !== repoId || !cur || cur.number !== pr.number) return;
		const mergeable = full ? (full.mergeable ?? null) : null;
		app.mergeBox = {
			number: pr.number,
			mergeable,
			mergeableState: full?.mergeableState ?? 'unknown'
		};
		if (full) applyPRStatus(full);
		// GitHub computes mergeability asynchronously; a freshly-opened PR can come
		// back null/'unknown'. Re-poll once after a beat so the box settles on its
		// own rather than needing a manual refresh.
		if (mergeable === null && mergeBoxRetriedFor !== pr.number) {
			mergeBoxRetriedFor = pr.number;
			setTimeout(() => {
				if (mergeBoxPR()?.number === pr.number) void refreshMergeBox();
			}, 2500);
		} else if (mergeable !== null) {
			mergeBoxRetriedFor = null;
		}
	} catch (err) {
		console.error('[mergeBox] refresh threw:', err);
	} finally {
		app.loadingMergeBox = false;
	}
}

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
		const can = await window.api.github.canPushToPR(app.activeRepo.id, $state.snapshot(pr));
		// Only definitive answers are cached — an unknown (null, e.g. a network
		// blip or a dead token) must be re-asked next refresh, not pinned for the
		// whole session.
		if (can !== null) prPushAccess.set(key, can);
		if (app.branchPR?.number === pr.number) app.branchPRPushAccess = can;
	} catch {
		// Leave unknown — better no warning than a wrong one.
	}
}

// Whether the active account can push to the repo's `origin`. Cached per repo
// for the session, so we hit the GitHub API at most once per repo. Leaves the
// answer unknown (null) when there's no GitHub remote / account, or on error —
// the fork banner only shows on a definitive `false`.
async function refreshRepoPushAccess(): Promise<void> {
	const repo = app.activeRepo;
	if (!repo || !repo.githubOwner || !repo.githubRepo || !app.activeGithubAccount) {
		app.repoPushAccess = null;
		return;
	}
	const cached = repoPushAccessChecked.get(repo.id);
	if (cached !== undefined) {
		app.repoPushAccess = cached;
		return;
	}
	try {
		const can = await window.api.github.getRepoPushAccess(repo.id);
		// Only definitive answers are cached for the session. An unknown (null —
		// network blip, dead token) is shown as unknown now but re-asked on the
		// next refresh; caching it once painted a permanent, wrong fork banner.
		if (can !== null) repoPushAccessChecked.set(repo.id, can);
		if (app.activeRepo?.id === repo.id) app.repoPushAccess = can;
	} catch {
		// Leave unknown — better no banner than a wrong one.
	}
}

// Update the active tab and persist it so the next launch lands on the same
// tab. Fire-and-forget on the persistence side — the UI already reflects the
// change, and prefs writes are cheap.
function applyContextTab(tab: ContextTab): void {
	app.contextTab = tab;
	// Remember this repo's tab for the session so switching away and back reopens
	// it (see restoreContextTab / switchRepo).
	if (app.activeRepo) contextTabByRepo.set(app.activeRepo.id, tab);
	// The query is scoped to "files on this tab/repo"; carrying it across
	// surfaces a stale filter that hides everything in the new context.
	app.fileSearchQuery = '';
	void window.api.state.setPrefs({ contextTab: tab }).then((prefs) => {
		app.prefs = prefs;
	});
}

// Snapshot the active repo's work-area layout for the session so switching away
// and back restores it (see applyRepoViewLayout / switchRepo). Called from every
// layout setter, the single chokepoints that mutate these flags.
function rememberViewLayout(): void {
	if (!app.activeRepo) return;
	viewLayoutByRepo.set(app.activeRepo.id, {
		commentsSidebarOpen: app.commentsSidebarOpen,
		commentsSidebarTab: app.commentsSidebarTab,
		conversationFullscreen: app.conversationFullscreen,
		sidebarCollapsed: app.sidebarCollapsed
	});
}

// Restore `repoId`'s remembered work-area layout — or a clean default for a repo
// not opened yet this session — and persist it as the active layout so the next
// launch restores it too. Setting the flags drives the panes via App.svelte's
// reactive effects ({#if} for the comments pane; the fullscreen + sidebar-
// collapse effects for the resizable panes). A repo with no memory never inherits
// another repo's open panel or fullscreen — that's the leak this fixes.
function applyRepoViewLayout(repoId: string): void {
	const saved = viewLayoutByRepo.get(repoId);
	const open = saved?.commentsSidebarOpen ?? false;
	const collapsed = saved?.sidebarCollapsed ?? false;
	app.sidebarCollapsed = collapsed;
	app.commentsSidebarOpen = open;
	app.commentsSidebarTab = saved?.commentsSidebarTab ?? 'comments';
	// Fullscreen only makes sense with the panel open and the left sidebar
	// collapsed; clamp away any inconsistent combination (mirrors the launch
	// restore) so the diff is never hidden with no way to bring it back.
	app.conversationFullscreen = (saved?.conversationFullscreen ?? false) && open && collapsed;
	rememberViewLayout();
	void window.api.state
		.setPrefs({
			commentsSidebarOpen: app.commentsSidebarOpen,
			commentsSidebarTab: app.commentsSidebarTab,
			conversationFullscreen: app.conversationFullscreen,
			sidebarCollapsed: app.sidebarCollapsed
		})
		.then((prefs) => {
			app.prefs = prefs;
		});
}

// Land on `savedTab` for the active repo, building its diff context and running
// the loads that tab needs, then persist it as the last-active tab. The Branch
// tab needs branches resolved first and falls back to Unstaged when it isn't
// viewable on the current branch (e.g. the default branch); Sessions/History
// only restore when their optional sidebar tab is enabled. Shared by launch
// restore and switchRepo so each repo reopens on the tab you left it on.
//
// `restoreScroll` (switchRepo only) rehydrates the file list's selected file and
// diff scroll position from the per-context cache before refreshing, so coming
// back to a repo lands the reviewer on the same file and spot they left — the
// same restore a within-repo tab switch does. The launch path skips it: the
// session cache is cold on startup, and per-tab scroll restore already runs from
// the persisted list.
async function restoreContextTab(
	savedTab: ContextTab | undefined,
	restoreScroll = false
): Promise<void> {
	// For the file-list tabs (Unstaged/Branch), repaint the cached file +
	// scroll position before refreshFiles so its `paint` keeps the selected file
	// and the diff view restores the saved spot instead of jumping to the top.
	const restoreFileScroll = async (load: () => Promise<unknown>): Promise<void> => {
		// Hydrate before kicking off the load so refreshFiles' `paint` sees the
		// restored selected file and keeps it (and app.scrollAnchor is set before
		// the diff view re-renders).
		const restored = restoreScroll && hydrateFilesFromCache();
		await load();
		// Nothing to restore (first visit to this repo's context this session) —
		// start on real content, skipping leading collapsed (already-seen) files.
		if (restoreScroll && !restored) actions.scrollToFirstExpanded();
	};
	if (savedTab === 'branch') {
		// The Branch tab needs branches resolved before it can build its diff
		// context (and before we can tell whether it's empty on this branch).
		await refreshBranches();
		if (canViewBranchTab()) {
			app.contextTab = 'branch';
			app.diffContext = contextForTab('branch');
		} else {
			// On the default branch, where the Branch tab is hidden — fall back to
			// the Unstaged working-tree view.
			app.contextTab = 'unstaged';
			app.diffContext = { kind: 'workingTree' };
		}
		await restoreFileScroll(() => Promise.all([refreshFiles(), refreshPushStatus()]));
	} else if (savedTab === 'sessions' && app.sidebarTabs.sessions) {
		app.contextTab = 'sessions';
		// The Sessions tab shows the documented-sessions list (in the sidebar),
		// not a working-tree file list. Still fetch the Unstaged badge count.
		await Promise.all([
			refreshBranches(),
			refreshPushStatus(),
			refreshUnstagedCount(),
			actions.loadSessions()
		]);
	} else if (savedTab === 'history' && app.sidebarTabs.history) {
		app.contextTab = 'history';
		// loadCommits needs branches resolved first so historyHeadRef() can fall
		// back to the current branch. Still fetch the Unstaged badge count.
		await Promise.all([refreshBranches(), refreshPushStatus(), refreshUnstagedCount()]);
		await actions.loadCommits();
	} else {
		app.contextTab = 'unstaged';
		app.diffContext = { kind: 'workingTree' };
		await restoreFileScroll(() =>
			Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()])
		);
	}
	if (app.activeRepo) contextTabByRepo.set(app.activeRepo.id, app.contextTab);
	void window.api.state.setPrefs({ contextTab: app.contextTab }).then((prefs) => {
		app.prefs = prefs;
	});
}

// The git ref whose committed sessions the UI should show, or null to read the
// working-tree sessions on disk. Sessions are committed into the branch, so a
// read-only view shows the viewed branch/PR's sessions (read from its ref) — the
// same ref the Branch diff reads as its head. The checked-out branch returns null
// so an agent's not-yet-committed CLI saves still show live from disk.
function sessionRef(): string | null {
	if (app.viewPR) return `pr/${app.viewPR.number}/head`;
	if (app.viewBranch && app.viewBranch !== app.currentBranch) return app.viewBranch;
	return null;
}

// The ref the Branch diff should use as its base. When a PR governs the current
// view (a checked-out branch with a PR, a read-only viewed branch's PR, or a PR
// view), diff against that PR's base branch tip — pinned to `pr/<n>/base` from
// the PR's own base repo, which may be an upstream/non-default branch. Diffing
// against the local default instead surfaces files and lines GitHub doesn't
// consider part of the PR, so review comments on them fail to resolve. Falls back
// to the local default branch when no PR governs the view, or its base hasn't
// been pinned yet (the diff briefly shows against the default until the pin
// lands and the view refreshes).
function branchDiffBaseRef(): string {
	const pr = uiPR();
	if (pr && app.fetchedPRBases.has(pr.number)) return `pr/${pr.number}/base`;
	// Cold start: the network PR lookup hasn't resolved yet (`pr` is null), but if
	// we remembered — and just re-verified — the base this checked-out branch was
	// diffed against last session, reuse it so the diff and its seen-state context
	// key don't flip when the lookup lands. Only for the checked-out branch; a
	// read-only view drives its base off `uiPR()` above.
	if (!isReadOnlyView() && app.rememberedBranchBase) return app.rememberedBranchBase;
	return app.activeRepo?.defaultBranch ?? 'main';
}

// The ref whose commit history the History tab lists: the read-only view's head
// (a fetched PR head ref or a viewed branch) when one is set, otherwise the
// checked-out branch. Mirrors the Branch tab's head so both follow the view.
function historyHeadRef(): string {
	if (app.viewPR) return `pr/${app.viewPR.number}/head`;
	return app.viewBranch ?? app.currentBranch ?? 'HEAD';
}

// Seed `rememberedBranchBase` from disk for the checked-out branch so the first
// Branch-tab paint targets the PR base it settled on last session, instead of
// the local default until the ~1s network PR lookup pins the base (which would
// load seen markers under the wrong context key, then flip). Cheap and local: a
// store read plus, only when a base was remembered, one `rev-parse` to confirm
// the `pr/<n>/base` ref still exists. Bails if the user switched away mid-read.
async function hydrateRememberedBranchBase(): Promise<void> {
	const repo = app.activeRepo;
	const branch = app.currentBranch;
	app.rememberedBranchBase = null;
	if (!repo || !branch) return;
	const base = await window.api.state.getBranchBase(repo.id, branch);
	if (!base || app.activeRepo?.id !== repo.id || app.currentBranch !== branch) return;
	if (!(await window.api.git.refExists(repo.id, base))) return;
	if (app.activeRepo?.id !== repo.id || app.currentBranch !== branch) return;
	app.rememberedBranchBase = base;
}

// Resolve which DiffContext the current tab should drive.
function contextForTab(tab: ContextTab): DiffContext {
	if (tab === 'branch') {
		// Target the read-only view when one is set — a fetched PR head ref, or a
		// view branch — otherwise the checked-out branch. All read from git refs,
		// so none touches disk.
		const head = app.viewPR
			? `pr/${app.viewPR.number}/head`
			: (app.viewBranch ?? app.currentBranch ?? 'HEAD');
		return { kind: 'branch', base: branchDiffBaseRef(), head };
	}
	if (tab === 'history' && app.activeCommit) {
		// An open commit drives its own diff (commit vs first parent). With no commit
		// open the History tab shows the list, not a diff — fall through to the
		// working-tree context below (unused while the list is shown).
		return { kind: 'commit', ref: app.activeCommit.hash };
	}
	if (tab === 'sessions' && app.activeSessionId) {
		// Read the open session from the viewed branch/PR's ref when reviewing
		// read-only, so its frozen diff matches the branch's committed manifest.
		return { kind: 'session', sessionId: app.activeSessionId, ref: sessionRef() ?? undefined };
	}
	// Sessions without an open session show the list, not a diff — fall back to
	// the working tree context (unused while the list is shown).
	return { kind: 'workingTree' };
}

// Structural equality for two session summaries. Covers every field the UI
// renders, so an unchanged refresh compares equal and we can skip the churn.
function sessionSummaryEqual(x: SessionSummary, y: SessionSummary): boolean {
	return (
		x.id === y.id &&
		x.repoId === y.repoId &&
		x.key === y.key &&
		x.name === y.name &&
		x.description === y.description &&
		x.harness === y.harness &&
		x.harnessLabel === y.harnessLabel &&
		x.harnessUrl === y.harnessUrl &&
		x.branch === y.branch &&
		x.baseRef === y.baseRef &&
		x.createdAt === y.createdAt &&
		x.updatedAt === y.updatedAt &&
		x.fileCount === y.fileCount &&
		x.additions === y.additions &&
		x.deletions === y.deletions &&
		x.stepCount === y.stepCount
	);
}

// Structural equality for two session lists. A focus/poll refresh re-fetches
// the sessions even when nothing on disk moved; reassigning `app.sessions` with
// the fresh (deeply-proxied) array there re-runs every keyed row's reactive
// reads and child subtrees, flashing and shifting the sessions list for no
// reason. We compare field-by-field so a genuine no-op refresh stays a no-op.
function sessionsEqual(a: SessionSummary[], b: SessionSummary[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!sessionSummaryEqual(a[i], b[i])) return false;
	}
	return true;
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
			kind: 'workingTree'
		});
		if (!app.activeRepo || app.activeRepo.id !== repoId) return;
		app.unstagedFileCount = files.length;
		setRepoDirty(repoId, files.length > 0);
	} catch {
		// keep previous count
	}
}

// Fetch the active repo's session count and store it on `app.sessionCount` so
// the Sessions tab badge stays accurate regardless of the active tab. Cheap
// (counts manifest files without parsing) and failure-silent like the count
// above.
async function refreshSessionCount(): Promise<void> {
	if (!app.activeRepo) {
		app.sessionCount = 0;
		return;
	}
	const repoId = app.activeRepo.id;
	// Count the viewed branch/PR's sessions when reviewing read-only, so the badge
	// matches the list shown; null follows the working tree.
	const ref = sessionRef();
	try {
		const count = await window.api.sessions.count(repoId, ref);
		if (app.activeRepo?.id === repoId) app.sessionCount = count;
	} catch {
		// keep previous count
	}
}

// ─── Local comments ──────────────────────────────────────────────────────────

// The diff-context key the active view's comments are scoped to. Comments are
// per-view (see LocalComment.contextKey), so this is the key we list/store under.
function localCommentContextKey(): string {
	return diffContextKey($state.snapshot(app.diffContext) as DiffContext);
}

// Who a comment authored in this app is attributed to: the active GitHub account
// (its display name or handle) when signed in, else a generic "You". Always a
// human — agents never author comments, only resolve them (via the CLI).
function localAuthor(): LocalCommentAuthor {
	const account = effectiveGithubAccount();
	const name = account?.name?.trim() || account?.login?.trim() || 'You';
	const avatarUrl = account?.avatarUrl?.trim();
	return { kind: 'human', name, ...(avatarUrl ? { avatarUrl } : {}) };
}

// Whether two comment lists are field-equal, so a no-op watcher/refresh doesn't
// churn the reactive array (which would flash the sidebar and rebuild inline
// annotations). Comments are immutable except on resolve, so comparing id +
// updatedAt is enough to catch every change.
function commentsEqual(a: LocalComment[], b: LocalComment[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].id !== b[i].id || a[i].updatedAt !== b[i].updatedAt) return false;
	}
	return true;
}

// Load the active context's local comments into `app.localComments`. Reads the
// viewed branch/PR's committed comments when reviewing read-only (via the ref),
// else the working tree on disk. Clears any open composers when the context
// changed out from under them.
async function loadLocalComments(): Promise<void> {
	if (!app.activeRepo) {
		app.localComments = [];
		app.localCommentsContextKey = null;
		return;
	}
	const repoId = app.activeRepo.id;
	const contextKey = localCommentContextKey();
	// A context switch invalidates composers anchored to the previous view, and the
	// outdated flags (each DiffFileSection re-derives them for the new diff).
	if (app.localCommentsContextKey !== contextKey) {
		app.localComposers = {};
		app.outdatedLocalCommentIds.clear();
		app.localCommentsContextKey = contextKey;
	}
	let comments: LocalComment[];
	try {
		comments = await window.api.comments.list(repoId, contextKey);
	} catch {
		return; // keep previous list on a transient failure
	}
	// Bail if the user moved on while we were fetching.
	if (!app.activeRepo || app.activeRepo.id !== repoId) return;
	if (localCommentContextKey() !== contextKey) return;
	if (!commentsEqual(comments, app.localComments)) app.localComments = comments;
}

// Remove working-tree comments orphaned by a commit. Given the set of paths that
// were committed, a comment is orphaned when its file was committed *and* has no
// changes left in the working tree (`app.changedFiles`), i.e. the diff it was
// pinned to is gone for good. Only the loaded (active) context's comments are
// considered, which on the commit path is the working tree. Best-effort: the
// comments-dir watcher reconciles `app.localComments` from disk, so a failed
// delete simply reappears rather than leaving the UI inconsistent.
async function pruneCommittedComments(repoId: string, committedPaths: string[]): Promise<void> {
	const committed = new Set(committedPaths);
	const stillChanged = new Set(app.changedFiles.map((f) => f.path));
	const orphaned = app.localComments.filter(
		(c) => committed.has(c.path) && !stillChanged.has(c.path)
	);
	if (orphaned.length === 0) return;
	const orphanedIds = new Set(orphaned.map((c) => c.id));
	app.localComments = app.localComments.filter((c) => !orphanedIds.has(c.id));
	await Promise.all(orphaned.map((c) => window.api.comments.remove(repoId, c.id).catch(() => {})));
}

// ── Copy-to-prompt formatting ──
// Comments are pinned to a line of a diff. An agent acting on the copied prompt
// works in the live file, where line numbers match the new (post-change) side —
// so a plain "line 240 in `path`" is enough. Only the original (pre-change) side
// needs a qualifier, since there the number refers to the old file.

// "line 5" / "lines 5-7" for a 1-based inclusive span.
function lineRangeLabel(start: number, end: number): string {
	return start === end ? `line ${start}` : `lines ${start}-${end}`;
}

// Appended after a line label when the comment sits on the original (pre-change)
// side of the diff. Empty for the new side, where the number matches the file.
function sideQualifier(side: 'LEFT' | 'RIGHT'): string {
	return side === 'LEFT' ? ' (original side)' : '';
}

// A header line for the "copy all" task lists, naming what the list is. The id
// in each item is what `super-review comment resolve <id>` takes, so the closing
// note tells the agent to resolve each by that id once it's addressed.
const COMMENTS_PROMPT_INTRO =
	'Address the following review comments left on a diff (the code changes under review). ' +
	'Each item gives its comment id, the file, the line(s), and the feedback. Line numbers ' +
	'are on the new (post-change) side unless marked "(original side)". When you finish a ' +
	'comment, mark it resolved with `super-review comment resolve <id>`:\n';

// Build a copy-ready prompt for a single comment: makes the diff context and the
// side explicit so an agent can act on it without the diff in front of them. The
// id is included so the agent can resolve it via `super-review comment resolve`.
function formatCommentPrompt(c: LocalComment): string {
	return (
		`Review comment \`${c.id}\` at ${lineRangeLabel(c.startLine, c.endLine)}` +
		`${sideQualifier(c.side)} in \`${c.path}\`:\n\n${c.body.trim()}\n\n` +
		`When addressed, mark it resolved: \`super-review comment resolve ${c.id}\``
	);
}

// Build a markdown task list from several comments, grouped by file, for the
// "copy all unresolved" header action.
function formatCommentsPrompt(comments: LocalComment[]): string {
	// Plain scratch Map in a pure function — not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const byFile = new Map<string, LocalComment[]>();
	for (const c of comments) {
		const list = byFile.get(c.path) ?? [];
		list.push(c);
		byFile.set(c.path, list);
	}
	const sections: string[] = [COMMENTS_PROMPT_INTRO];
	for (const [path, list] of byFile) {
		sections.push(`### ${path}`);
		for (const c of list) {
			const where = `${lineRangeLabel(c.startLine, c.endLine)}${sideQualifier(c.side)}`;
			const body = c.body.trim().replace(/\n/g, '\n  ');
			sections.push(`- [ ] \`${c.id}\` **${where}** - ${body}`);
		}
		sections.push('');
	}
	return sections.join('\n').trim();
}

// Copy-ready prompt for a single PR review comment — same shape as the local
// formatter so an agent gets a consistent instruction regardless of source.
function formatPRCommentPrompt(c: PRReviewComment): string {
	// Fall back to the original line for outdated comments (their live `line` is
	// gone) so the prompt still points at where the comment was made, flagged so
	// the agent knows the code there may have since changed.
	const line = c.line ?? c.originalLine;
	const outdated = c.isOutdated ? ' (outdated)' : '';
	const loc =
		line != null
			? `at line ${line}${sideQualifier(c.side)} in \`${c.path}\`${outdated}`
			: `on \`${c.path}\` (file-level)`;
	return `Review comment ${loc}:\n\n${c.body.trim()}`;
}

// Markdown task list from several PR review comments, grouped by file.
function formatPRCommentsPrompt(comments: PRReviewComment[]): string {
	// Plain scratch Map in a pure function — not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const byFile = new Map<string, PRReviewComment[]>();
	for (const c of comments) {
		const list = byFile.get(c.path) ?? [];
		list.push(c);
		byFile.set(c.path, list);
	}
	const sections: string[] = [COMMENTS_PROMPT_INTRO];
	for (const [path, list] of byFile) {
		sections.push(`### ${path}`);
		for (const c of list) {
			const line = c.line ?? c.originalLine;
			const where =
				line != null
					? `line ${line}${sideQualifier(c.side)}${c.isOutdated ? ' (outdated)' : ''}`
					: 'file-level';
			const body = c.body.trim().replace(/\n/g, '\n  ');
			sections.push(`- [ ] **${where}** - ${body}`);
		}
		sections.push('');
	}
	return sections.join('\n').trim();
}

// Check whether the super-review skill is installed in the active repo and
// store the result. Failure-silent — leaves the answer unknown (null) so the
// install prompts stay hidden rather than flashing on a transient error.
async function refreshSkillInstalled(): Promise<void> {
	if (!app.activeRepo) {
		app.skillInstalled = null;
		return;
	}
	const repoId = app.activeRepo.id;
	try {
		const installed = await window.api.skill.isInstalled(repoId);
		if (app.activeRepo?.id === repoId) app.skillInstalled = installed;
	} catch {
		// Leave unknown — don't surface a banner over a non-critical check.
	}
}

// Flip a single repo's dirty flag in `dirtyRepoIds`. It's a SvelteSet, so the
// in-place mutation is reactive. No-op when the flag already matches.
function setRepoDirty(repoId: string, dirty: boolean): void {
	if (dirty === app.dirtyRepoIds.has(repoId)) return;
	if (dirty) app.dirtyRepoIds.add(repoId);
	else app.dirtyRepoIds.delete(repoId);
}

// Recompute the dirty flag for every known repo in parallel. Drives the repo
// picker's "uncommitted changes" dot. Each check is a cheap `git status`;
// failures count as clean so a transient error never sticks a dot on a repo.
async function refreshDirtyRepos(): Promise<void> {
	const repos = app.repos;
	const results = await Promise.all(
		repos.map(async (r) => [r.id, await window.api.git.isDirty(r.id).catch(() => false)] as const)
	);
	app.dirtyRepoIds = new SvelteSet(results.filter(([, dirty]) => dirty).map(([id]) => id));
}

// Recompute whether the current branch is missing a changeset. Guarded against a
// repo switch landing while we're awaiting so a stale result can't overwrite the
// new repo's status.
async function refreshChangesetStatus(repoId: string): Promise<void> {
	// Changesets integration turned off in settings — keep everything silent.
	if (!app.changesetsEnabled) {
		app.changesetStatus = null;
		return;
	}
	try {
		const status = await window.api.changesets.getStatus(repoId);
		if (app.activeRepo?.id !== repoId) return;
		app.changesetStatus = status;
	} catch {
		if (app.activeRepo?.id === repoId) app.changesetStatus = null;
	}
}

async function refreshFiles(): Promise<void> {
	if (!app.activeRepo) {
		app.changedFiles = [];
		app.unstagedFileCount = 0;
		app.localComments = [];
		app.localCommentsContextKey = null;
		app.changesetStatus = null;
		return;
	}
	// The Sessions/History tabs with nothing open show a list (sessions or
	// commits), not a file list — don't let a background refresh (focus/poll)
	// repopulate the sidebar with working-tree files behind it. Keep the Unstaged
	// badge fresh, though.
	if (
		(app.contextTab === 'sessions' && !app.activeSessionId) ||
		(app.contextTab === 'history' && !app.activeCommit)
	) {
		app.changedFiles = [];
		// The sessions list shows no diff, so there's nothing to anchor comments to.
		app.localComments = [];
		app.localCommentsContextKey = null;
		void refreshUnstagedCount();
		// The header's changeset button keys off `installed`, which must hold on
		// every tab — keep it fresh even on the bare sessions list.
		void refreshChangesetStatus(app.activeRepo.id);
		return;
	}
	const repoId = app.activeRepo.id;
	const ctx = $state.snapshot(app.diffContext) as DiffContext;
	const cacheKey = filesCacheKey(repoId, ctx);
	const hadCache = filesCache.has(cacheKey);

	const ctxKey = diffContextKey(ctx);
	// Review state (seen / collapsed) is keyed independent of the diff base so it
	// loads under a stable key from the first paint, regardless of when the base
	// resolves. The file-list cache stays on `ctxKey` (it really does depend on
	// the base).
	const reviewKey = reviewContextKey(ctx);
	// Whether we've already put a file list on screen (in-memory cache hit, or a
	// cold-start paint from the persisted list). Drives error handling: if the git
	// diff fails we keep what's shown rather than wiping to an error state.
	let hydrated = hadCache;

	// True once the user has switched repo/context out from under an await, so we
	// drop a stale result instead of painting it over the new context.
	const stale = (): boolean =>
		!app.activeRepo ||
		app.activeRepo.id !== repoId ||
		filesCacheKey(repoId, $state.snapshot(app.diffContext) as DiffContext) !== cacheKey;

	// Paint the sidebar from a changed-file list plus the authoritative
	// seen/collapsed state. Shared by the instant cold-start paint (from the
	// persisted list) and the post-git-diff paint. `unmarkChanged` runs the
	// "clear seen on changed files" pass — only meaningful against the fresh git
	// list, so the cold-start paint skips it (its list may predate new commits).
	const paint = (
		rawList: ChangedFile[],
		seenList: string[],
		seenSigs: Record<string, string>,
		collapsedList: string[],
		unmarkChanged: boolean
	): ChangedFile[] => {
		// Sort by path so the diff view and the sidebar tree agree on order —
		// otherwise the "first file in the tree" can land mid-list in the diff
		// view, and scrolling past it jumps to whatever git happened to list
		// before/after instead of feeling like you're at the boundary.
		const files = [...rawList].sort((a, b) => comparePathsVSCodeStyle(a.path, b.path));
		const seenSet = new SvelteSet(seenList);
		const collapsedSet = new SvelteSet(collapsedList);

		// Clear the "seen" mark on any file whose content changed since it was
		// marked — fresh commits on a branch, or further working-tree edits — so it
		// resurfaces for re-review. We compare the signature captured at mark-seen
		// time against the current one; a missing/empty stored signature (older
		// data) is left alone since we have no baseline. Persist each clear so the
		// mark stays gone across refreshes. Opt-out via the unmarkSeenOnChange pref.
		if (unmarkChanged && app.unmarkSeenOnChange) {
			for (const file of files) {
				if (!seenSet.has(file.path)) continue;
				const prevSig = seenSigs[file.path];
				const curSig = fileContentSig(file);
				if (prevSig && sigsComparable(prevSig, curSig) && prevSig !== curSig) {
					seenSet.delete(file.path);
					void window.api.state.setFileSeen(repoId, reviewKey, file.path, false);
				}
			}
		}

		const stillSelected = app.selectedFile && files.some((f) => f.path === app.selectedFile);
		const firstUnseen = files.find((f) => !seenSet.has(f.path));
		const nextSelected = stillSelected
			? app.selectedFile
			: (firstUnseen?.path ?? files[0]?.path ?? null);

		app.changedFiles = files;
		app.seenFiles = seenSet;
		app.collapsedFiles = collapsedSet;
		app.selectedFile = nextSelected;
		// Carry the saved scroll position forward across the repaint, dropping it
		// only when its file is gone, so a refresh of the *current* context lands
		// the reviewer back where they were rather than at the top.
		const prevAnchor = filesCache.get(cacheKey)?.scrollAnchor ?? null;
		const scrollAnchor =
			prevAnchor && files.some((f) => f.path === prevAnchor.path) ? prevAnchor : null;
		filesCache.set(cacheKey, {
			changedFiles: files,
			seenFiles: new Set(seenSet),
			collapsedFiles: new Set(collapsedSet),
			selectedFile: nextSelected,
			scrollAnchor
		});
		// There's content on screen now — drop any loading spinner the caller (or
		// the cold-start fallback below) turned on.
		app.loading.files = false;
		return files;
	};

	try {
		// Read the cheap, authoritative review state first. These are just store
		// lookups — they return in well under a frame, unlike the branch git diff —
		// so on a cold start we can paint the sidebar (with correct seen markers)
		// from the file list we persisted last time, instead of sitting on a
		// spinner while git computes the diff. The persisted list rides along in
		// the same batch, but only when the in-memory cache missed.
		const [seenList, seenSigs, collapsedList, persisted] = await Promise.all([
			window.api.state.getSeenFiles(repoId, reviewKey),
			window.api.state.getSeenSignatures(repoId, reviewKey),
			window.api.state.getCollapsedFiles(repoId, reviewKey),
			hadCache
				? Promise.resolve<ChangedFile[]>([])
				: window.api.state.getCachedFileList(repoId, ctxKey)
		]);
		// Bail if the user switched tabs / repos while we were fetching.
		if (stale()) return;

		// Cold start: paint the persisted list instantly so seen markers show right
		// away, then let the git diff below revalidate. Fall back to the spinner
		// only when there's nothing on disk to show either.
		if (!hadCache) {
			if (persisted.length) {
				paint(persisted, seenList, seenSigs, collapsedList, false);
				hydrated = true;
			} else {
				app.loading.files = true;
			}
		}

		const raw = await window.api.git.listChangedFiles(repoId, ctx);
		if (stale()) return;
		const files = paint(raw, seenList, seenSigs, collapsedList, true);
		// Persist the fresh list so the next cold start can paint it immediately.
		void window.api.state.setCachedFileList(repoId, ctxKey, files);
		// Remember the checked-out branch's base so the next cold start targets the
		// same (PR) base from the first paint, keeping the seen-state context key
		// stable. Clear it when the diff fell back to the default branch (e.g. the
		// PR merged) so a stale `pr/<n>/base` isn't reused. Only write when the base
		// actually changed — refreshFiles runs often and each store write rewrites
		// the whole config file.
		if (ctx.kind === 'branch' && !isReadOnlyView()) {
			const def = app.activeRepo?.defaultBranch ?? 'main';
			const nextBase = ctx.base === def ? null : ctx.base;
			if (nextBase !== app.rememberedBranchBase) {
				app.rememberedBranchBase = nextBase;
				void window.api.state.setBranchBase(repoId, ctx.head, nextBase);
			}
		}

		// Drop any multi-selection entries for files that left this context (got
		// committed, discarded, or changed tabs) so bulk actions never target a
		// path that's no longer in the list.
		if (app.selectedFiles.size > 0) {
			const present = new Set(files.map((f) => f.path));
			const pruned = new SvelteSet([...app.selectedFiles].filter((p) => present.has(p)));
			if (pruned.size !== app.selectedFiles.size) {
				app.selectedFiles = pruned;
			}
		}

		// Drop commit-exclusions for files that are no longer in the working tree
		// (committed, discarded, or reverted) so the "select all" state stays
		// accurate. Only prune against the working-tree list — the branch/PR
		// contexts list different files and would wrongly clear the selection.
		if (ctx.kind === 'workingTree' && app.excludedFromCommit.size > 0) {
			const present = new Set(files.map((f) => f.path));
			const pruned = new SvelteSet([...app.excludedFromCommit].filter((p) => present.has(p)));
			if (pruned.size !== app.excludedFromCommit.size) {
				app.excludedFromCommit = pruned;
			}
		}

		// Same pruning for per-line staging exclusions: drop keys for files that
		// have left the working tree (pathFromLineKey recovers the path).
		if (ctx.kind === 'workingTree' && app.stagingLineExclusions.size > 0) {
			const present = new Set(files.map((f) => f.path));
			const pruned = new SvelteSet(
				[...app.stagingLineExclusions].filter((k) => present.has(pathFromLineKey(k)))
			);
			if (pruned.size !== app.stagingLineExclusions.size) {
				app.stagingLineExclusions = pruned;
			}
		}

		// Keep the Unstaged tab badge in sync. When the active context already is
		// the working tree, the fetched list IS the unstaged count; otherwise we
		// need a separate fetch since the active tab isn't tracking it.
		if (ctx.kind === 'workingTree') {
			app.unstagedFileCount = files.length;
			setRepoDirty(repoId, files.length > 0);
		} else {
			void refreshUnstagedCount();
		}
		// Keep the changeset status fresh in every context. The "Add a changeset?"
		// prompt only mounts on the Unstaged tab, so the status's working-tree
		// prompt fields stay invisible elsewhere — but the header's changeset
		// button keys off `installed`, a repo-level fact that must hold on every
		// tab. Nulling it here used to hide the button on the Branch/PR tabs.
		void refreshChangesetStatus(repoId);

		app.lastRefreshAt = Date.now();
		// Load the local comments pinned to this context's diff (cheap; reads the
		// small per-comment JSON set). Fire-and-forget so it never blocks the files.
		void loadLocalComments();
	} catch (err) {
		// On error, keep showing whatever we hydrated from (in-memory or the
		// persisted list). Only surface the error when we had nothing to show.
		if (!hydrated) {
			setError(err instanceof Error ? err.message : String(err));
			app.changedFiles = [];
			app.selectedFile = null;
		}
	} finally {
		app.loading.files = false;
	}
}

// Append a page of PRs, dropping any whose number already appears — paging can
// overlap when the list shifts between requests. Module-private so its
// throwaway lookup Set stays an ordinary (non-reactive) Set.
function appendUniquePRs(existing: PRSummary[], page: PRSummary[]): PRSummary[] {
	const seen = new Set(existing.map((p) => p.number));
	return [...existing, ...page.filter((p) => !seen.has(p.number))];
}

// De-duplicate a list of strings, preserving first-seen order.
function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}

// Clamp a window dimension to its minimum, falling back to the default for
// empty/invalid input. Mirrors the main process's windowDimension so the
// renderer never persists a value the window can't honor.
function clampWindowDimension(value: number, min: number, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.max(min, Math.floor(n));
}

export const actions = {
	openChangesetDialog(): void {
		app.changesetDialogOpen = true;
	},
	closeChangesetDialog(): void {
		app.changesetDialogOpen = false;
	},
	async setSignCommits(value: boolean): Promise<void> {
		app.signCommits = value;
		app.prefs = await window.api.state.setPrefs({ signCommits: value });
	},
	// Show/hide a single optional header control (sidebar toggle, changeset,
	// editor, terminal) from the header's right-click menu. Updates the local
	// copy first so the header reacts instantly, then persists the merged map.
	async setHeaderItem(key: keyof HeaderItemVisibility, value: boolean): Promise<void> {
		app.headerItems = { ...app.headerItems, [key]: value };
		app.prefs = await window.api.state.setPrefs({
			headerItems: { ...app.headerItems }
		});
	},

	// Show/hide an optional sidebar tab (Sessions, History) from the tab strip's
	// right-click menu. Updates the local copy first so the strip reacts instantly,
	// then persists. Hiding the tab you're currently on would strand you on a tab
	// whose trigger is gone, so fall back to a still-visible tab first.
	async setSidebarTab(key: keyof SidebarTabVisibility, value: boolean): Promise<void> {
		if (!value && app.contextTab === key) {
			// Unstaged is the universal home; while a branch/PR is viewed read-only it's
			// hidden, so the Branch tab (always present in that view) takes its place.
			await actions.setContextTab(isReadOnlyView() ? 'branch' : 'unstaged');
		}
		app.sidebarTabs = { ...app.sidebarTabs, [key]: value };
		app.prefs = await window.api.state.setPrefs({
			sidebarTabs: { ...app.sidebarTabs }
		});
	},
	async setChangesetsEnabled(value: boolean): Promise<void> {
		app.changesetsEnabled = value;
		app.prefs = await window.api.state.setPrefs({ changesetsEnabled: value });
		// Reflect the change immediately: clear the status when turning off, or
		// recompute it (in the right context) when turning on.
		if (!value) {
			app.changesetStatus = null;
		} else if (app.activeRepo) {
			await refreshFiles();
		}
	},
	dismissChangesetPrompt(): void {
		app.changesetPromptDismissed = true;
	},
	dismissChangesetWarning(): void {
		app.changesetWarningDismissed = true;
	},
	dismissSkillInstall(): void {
		app.skillInstallDismissed = true;
	},
	openChangesetReview(): void {
		app.changesetReviewOpen = true;
	},
	closeChangesetReview(): void {
		app.changesetReviewOpen = false;
	},
	// Delete a changeset file the user judged unnecessary, then refresh so the
	// warning and the file list update.
	async removeChangeset(path: string): Promise<void> {
		const repoId = app.activeRepo?.id;
		if (!repoId) return;
		try {
			await window.api.changesets.remove(repoId, path);
			await refreshFiles();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	},
	// Write a new changeset for the selected packages, then refresh: the new
	// `.changeset/*.md` shows up in the working tree (and the commit-box auto-fill
	// picks up its description), and the "Add a changeset?" prompt clears.
	async createChangeset(
		packages: string[],
		bump: 'patch' | 'minor' | 'major',
		description: string,
		name?: string
	): Promise<boolean> {
		const repoId = app.activeRepo?.id;
		if (!repoId) return false;
		try {
			await window.api.changesets.create(repoId, { packages, bump, description, name });
			app.changesetDialogOpen = false;
			await refreshFiles();
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
		}
	},
	async init(): Promise<void> {
		app.prefs = await window.api.state.getPrefs();
		app.viewMode = app.prefs.viewMode;
		app.diffLayout = app.prefs.diffLayout ?? 'scroll';
		app.unstagedFileListLayout = app.prefs.unstagedFileListLayout;
		app.branchFileListLayout = app.prefs.branchFileListLayout;
		app.showFileIcons = app.prefs.showFileIcons;
		app.openFileOnArrowNav = app.prefs.openFileOnArrowNav;
		app.maxDiffLines = app.prefs.maxDiffLines;
		app.hiddenDiffPatterns = app.prefs.hiddenDiffPatterns;
		app.customFileIcons = app.prefs.customFileIcons;
		// Migrate the legacy boolean `animationsEnabled` to the 3-way mode: an
		// explicit on→'all' and off→'none' preserve the prior choice; anything
		// unset falls through to the new 'accents' default.
		{
			const legacy = (app.prefs as { animationsEnabled?: boolean }).animationsEnabled;
			app.animations =
				app.prefs.animations ?? (legacy === true ? 'all' : legacy === false ? 'none' : 'accents');
		}
		app.prMergedBehavior = app.prefs.prMergedBehavior ?? 'prompt';
		app.autoRemoveMergedBranch = app.prefs.autoRemoveMergedBranch ?? false;
		app.unmarkSeenOnChange = app.prefs.unmarkSeenOnChange ?? true;
		app.changesetsEnabled = app.prefs.changesetsEnabled ?? true;
		app.signCommits = app.prefs.signCommits ?? true;
		app.recentRepoCount = app.prefs.recentRepoCount ?? 5;
		app.windowWidth = app.prefs.windowWidth ?? WINDOW_BOUNDS.defaultWidth;
		app.windowHeight = app.prefs.windowHeight ?? WINDOW_BOUNDS.defaultHeight;
		app.startMaximized = app.prefs.startMaximized ?? false;
		app.sidebarCollapsed = app.prefs.sidebarCollapsed ?? false;
		app.commentsSidebarOpen = app.prefs.commentsSidebarOpen ?? false;
		app.commentsSidebarTab = app.prefs.commentsSidebarTab ?? 'comments';
		// Fullscreen only makes sense with the comments panel open and the left
		// sidebar collapsed; clamp away inconsistent persisted combinations so the
		// layout never restores with the diff hidden and no way to bring it back.
		app.conversationFullscreen =
			(app.prefs.conversationFullscreen ?? false) &&
			app.commentsSidebarOpen &&
			app.sidebarCollapsed;
		app.hotkeys = { ...DEFAULT_HOTKEYS, ...app.prefs.hotkeys };
		app.headerItems = { ...DEFAULT_HEADER_ITEMS, ...app.prefs.headerItems };
		app.sidebarTabs = { ...DEFAULT_SIDEBAR_TABS, ...app.prefs.sidebarTabs };
		app.theme = app.prefs.theme;
		applyTheme(app.theme);
		app.diffTheme = app.prefs.diffTheme ?? DEFAULT_DIFF_THEME;
		// Only reconfigure the pool when it's not the default it already booted
		// with — avoids eagerly initializing the workers at startup for the common
		// case (the pool defaults to the 'pierre' pair).
		if (app.diffTheme !== DEFAULT_DIFF_THEME) applyDiffTheme();
		app.accent = app.prefs.accent ?? 'super';
		applyAccent(app.accent);
		app.codeFont = app.prefs.codeFont;
		app.uiFont = app.prefs.uiFont;
		applyFonts();
		void loadSystemFonts();
		await refreshGithubAccounts();
		// Probe the stored tokens in the background so one revoked while the app
		// was closed surfaces the sign-in prompt right away, not whenever a feature
		// first happens to fail. Offline is fine — only real auth failures flag.
		void window.api.github.validateAccounts().then((errors) => {
			app.githubAuthErrors = errors;
		});
		app.platform = window.api.platform;
		app.editors = await window.api.editor.detect();
		app.terminals = await window.api.terminal.detect();
		await refreshRepos();
		app.activeRepo = await window.api.repos.getActive();
		if (app.activeRepo) {
			repoFrecency.use(app.activeRepo.id);
			// Seed this repo's per-session layout memory from the launch state (read
			// from prefs just above) so switching away and back restores it.
			rememberViewLayout();
			// Local filesystem stat — fire it now so it isn't stranded behind the tab
			// restore + network PR lookup below.
			void refreshSkillInstalled();
			// Restore the last tab. Shared with switchRepo so the active repo also
			// seeds its per-repo tab memory for this session.
			await restoreContextTab(app.prefs.contextTab);
			await refreshBranchPR();
		}
		// Pre-populate the picker's "uncommitted changes" dots. Deferred to the end
		// of init so its per-repo `git status` flood doesn't compete with — and
		// delay — the first paint of the active repo's view (which would flash the
		// empty state). The picker also refreshes these whenever it opens.
		void refreshDirtyRepos();
	},

	async openRepo(): Promise<void> {
		try {
			const repo = await window.api.repos.openPicker();
			if (repo) await activateRepo(repo);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	async openFolder(): Promise<void> {
		try {
			const repos = await window.api.repos.openFolder();
			if (repos.length === 0) return; // Picker cancelled.
			applyContextTab('unstaged');
			app.diffContext = { kind: 'workingTree' };
			app.viewBranch = null;
			app.viewPR = null;
			await refreshRepos();
			app.activeRepo = await window.api.repos.getActive();
			if (app.activeRepo) {
				repoFrecency.use(app.activeRepo.id);
				// Local filesystem stat — fire it now, not behind the network PR lookup.
				void refreshSkillInstalled();
				await Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()]);
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
				if (result.error && result.error !== 'Clone cancelled.') {
					setError(result.error);
				}
				return;
			}
			applyContextTab('unstaged');
			app.diffContext = { kind: 'workingTree' };
			app.viewBranch = null;
			app.viewPR = null;
			await refreshRepos();
			app.activeRepo = await window.api.repos.getActive();
			if (app.activeRepo) {
				repoFrecency.use(app.activeRepo.id);
				// Local filesystem stat — fire it now, not behind the network PR lookup.
				void refreshSkillInstalled();
				await Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()]);
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
			// Snapshot the outgoing repo's work-area layout before switching, then
			// restore the incoming repo's so each repo keeps its own panel/fullscreen/
			// sidebar state instead of inheriting the one we're leaving.
			rememberViewLayout();
			app.activeRepo = repo;
			applyRepoViewLayout(repo.id);
			repoFrecency.use(repo.id);
			// Local filesystem stat — fire it now so the skill banner resolves without
			// waiting on the network PR lookup below.
			void refreshSkillInstalled();
			// Switching repos drops any tab-scoped file search; restoreContextTab
			// below lands on whichever tab this repo was last left on.
			app.fileSearchQuery = '';
			app.diffContext = { kind: 'workingTree' };
			app.viewBranch = null;
			app.viewPR = null;
			// Clear the outgoing repo's file list / diff so it doesn't linger while
			// the new repo loads. restoreContextTab rehydrates the selected file +
			// scroll anchor from the per-context cache below; clearing the anchor here
			// means a cache miss (first visit this session) starts clean at the top
			// rather than carrying the previous repo's scroll position.
			app.changedFiles = [];
			app.selectedFile = null;
			app.selectedFiles = new SvelteSet();
			app.scrollAnchor = null;
			app.activeSessionId = null;
			app.activeSessionDetail = null;
			app.sessions = [];
			app.sessionCount = 0;
			app.activeCommit = null;
			app.commits = [];
			app.historyForkPoint = null;
			app.skillInstalled = null;
			app.skillInstallDismissed = false;
			app.excludedFromCommit = new SvelteSet();
			app.stagingLineExclusions = new SvelteSet();
			app.prs = [];
			app.prsHasMore = false;
			prsPage = 0;
			app.prsSource = prsSourceByRepo.get(repo.id) ?? defaultPRSource(repo);
			app.branchPR = null;
			// Don't carry the previous repo's fork prompt / push-access answer over;
			// they're re-resolved for the new repo by refreshBranchPR below.
			app.forkPrompt = null;
			app.repoPushAccess = null;
			await Promise.all([refreshRepos(), restoreContextTab(contextTabByRepo.get(repo.id), true)]);
			await refreshBranchPR();
		}
	},

	async removeRepo(id: string, moveToTrash = false): Promise<void> {
		const wasActive = app.activeRepo?.id === id;
		await window.api.repos.remove(id, moveToTrash);
		setRepoDirty(id, false);
		await refreshRepos();
		if (!wasActive) return;
		// Land on the most-recently-opened remaining repo (the one at the top of the
		// picker's "Recent" list) rather than dropping to the empty state.
		const next = [...app.repos].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
		if (next) {
			await actions.switchRepo(next.id);
		} else {
			// No repos left — fall back to the empty view.
			app.activeRepo = null;
			app.changedFiles = [];
			app.unstagedFileCount = 0;
			app.branches = [];
			app.selectedFile = null;
			app.skillInstalled = null;
			app.skillInstallDismissed = false;
		}
	},

	// Recompute the "uncommitted changes" dot for every repo. Called when the
	// repo picker opens so its dots reflect the current state.
	async refreshDirtyRepos(): Promise<void> {
		await refreshDirtyRepos();
	},

	async setDiffContext(ctx: DiffContext): Promise<void> {
		app.diffContext = ctx;
		if (ctx.kind !== 'pr') {
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
		if (tab === 'sessions') {
			// Show the sessions list: clear the file list and load the manifests.
			// Selecting a session (openSession) is what populates the diff view.
			app.activeSessionId = null;
			app.activeSessionDetail = null;
			app.changedFiles = [];
			app.selectedFile = null;
			app.seenFiles = new SvelteSet();
			app.collapsedFiles = new SvelteSet();
			app.diffContext = { kind: 'workingTree' };
			void actions.loadSessions();
			return;
		}
		if (tab === 'history') {
			// Show the commit list: clear the file list and load the commits.
			// Selecting a commit (openCommit) is what populates the diff view.
			app.activeCommit = null;
			app.changedFiles = [];
			app.selectedFile = null;
			app.seenFiles = new SvelteSet();
			app.collapsedFiles = new SvelteSet();
			app.diffContext = { kind: 'workingTree' };
			void actions.loadCommits();
			return;
		}
		app.diffContext = contextForTab(tab);
		let restoredAnchor: ScrollAnchor | null = null;
		if (app.activeRepo) {
			const cached = filesCache.get(
				filesCacheKey(app.activeRepo.id, $state.snapshot(app.diffContext) as DiffContext)
			);
			if (cached) {
				app.changedFiles = cached.changedFiles;
				app.seenFiles = new SvelteSet(cached.seenFiles);
				app.collapsedFiles = new SvelteSet(cached.collapsedFiles);
				app.selectedFile = cached.selectedFile;
				restoredAnchor = cached.scrollAnchor ?? null;
			}
		}
		// Hold the reviewer's previous place in this tab if we have one; the diff
		// view reads this anchor when the rebuilt list mounts. Otherwise clear it so
		// `scrollToFirstExpanded` below isn't overridden by a stale anchor.
		app.scrollAnchor = restoredAnchor;
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
		// With a saved scroll position the diff view restores it on its own; only
		// when there's nothing to restore do we start the reviewer on real content,
		// skipping any leading collapsed (already-seen) files this context restored.
		if (!restoredAnchor) actions.scrollToFirstExpanded();
	},

	// Load the active repo's documented sessions into `app.sessions`. Called on
	// entering the Sessions tab and on refresh, so an agent's CLI update is
	// picked up. If a session is open, re-open it so its diff reflects the latest
	// re-capture; if it has since been removed, fall back to the list.
	async loadSessions(): Promise<void> {
		if (!app.activeRepo) {
			app.sessions = [];
			app.sessionCount = 0;
			return;
		}
		const repoId = app.activeRepo.id;
		// While a branch/PR is viewed read-only, list its committed sessions (read
		// from the ref) instead of the checked-out branch's working-tree sessions.
		const sessions = await window.api.sessions.list(repoId, sessionRef());
		if (!app.activeRepo || app.activeRepo.id !== repoId) return;

		// Grab the open session's previous + next summary before swapping the list
		// in, so we can tell a real re-capture apart from a no-op refresh.
		const openId = app.activeSessionId;
		const prevOpen = openId ? app.sessions.find((s) => s.id === openId) : undefined;
		const nextOpen = openId ? sessions.find((s) => s.id === openId) : undefined;

		// Only swap in the fresh list when it actually differs — a focus/poll
		// refresh that finds nothing changed must not churn the keyed list (it
		// flashes and shifts the sessions view).
		if (!sessionsEqual(sessions, app.sessions)) {
			app.sessions = sessions;
			// Keep the badge in step with the freshly loaded list.
			app.sessionCount = sessions.length;
		}

		if (openId) {
			if (!nextOpen) {
				// The open session was removed on disk — fall back to the list.
				actions.closeSession();
			} else if (!prevOpen || !sessionSummaryEqual(prevOpen, nextOpen)) {
				// A re-capture landed (its summary moved) — re-open so the frozen diff
				// and tour reflect the update. Skipped when nothing changed, otherwise
				// every refresh would reset the view to the tour, drop the file search,
				// and reload the diff, flashing and shifting the open session.
				await actions.openSession(openId);
			}
		}
	},

	// Open a session's frozen diff: drives the file list + diff view through the
	// existing context machinery via a `session` DiffContext. Also loads the full
	// session detail (incl. tour steps) so the tour can render.
	async openSession(id: string): Promise<void> {
		// The ref a read-only view reads sessions from; the diff handlers and the
		// detail fetch below both honor it so the tour matches the viewed branch.
		const ref = sessionRef();
		app.activeSessionId = id;
		app.diffContext = { kind: 'session', sessionId: id, ref: ref ?? undefined };
		app.activePR = null;
		app.prComments = {};
		app.pendingComposers = {};
		app.localComposers = {};
		app.activeSessionDetail = null;
		// Land on the tour; the file search query carries no meaning into a fresh
		// session, so clear it (the Changes tab re-enables search).
		app.sessionView = 'tour';
		app.fileSearchQuery = '';
		if (app.activeRepo) {
			const repoId = app.activeRepo.id;
			void window.api.sessions.get(repoId, id, ref).then((detail) => {
				// Guard against a slow fetch landing after the user moved on.
				if (app.activeSessionId === id && app.activeRepo?.id === repoId) {
					app.activeSessionDetail = detail;
				}
			});
		}
		await refreshFiles();
	},

	// Open a documented session from outside the sessions list — e.g. clicking a
	// session manifest's card in a diff. Switch to the Sessions tab first so the
	// session's back button returns to the list (and `app.sessions` is loaded for
	// the viewed ref), then open it. Honors the current read-only ref via the
	// existing actions.
	async viewSession(id: string): Promise<void> {
		await actions.setContextTab('sessions');
		await actions.openSession(id);
	},

	// Switch an open session between its tour and the plain changes view. Moving
	// to the tour drops any file-search filter (the tour has no search box).
	setSessionView(view: 'tour' | 'changes'): void {
		if (app.sessionView === view) return;
		app.sessionView = view;
		if (view === 'tour') app.fileSearchQuery = '';
	},

	// Leave an open session and return to the sessions list.
	closeSession(): void {
		app.activeSessionId = null;
		app.activeSessionDetail = null;
		app.changedFiles = [];
		app.selectedFile = null;
		app.seenFiles = new SvelteSet();
		app.collapsedFiles = new SvelteSet();
		app.localComments = [];
		app.localComposers = {};
		app.localCommentsContextKey = null;
		app.diffContext = { kind: 'workingTree' };
	},

	async deleteSession(id: string): Promise<void> {
		if (!app.activeRepo) return;
		await window.api.sessions.remove(app.activeRepo.id, id);
		if (app.activeSessionId === id) actions.closeSession();
		await actions.loadSessions();
	},

	// Remove every session for the active repo — the "clear before merging" purge.
	// Sessions now live in the repo's .super-review/ folder, so this also clears
	// them from the working tree (git sees the committed manifests as deleted).
	async clearSessions(): Promise<void> {
		if (!app.activeRepo) return;
		await window.api.sessions.clear(app.activeRepo.id);
		actions.closeSession();
		await actions.loadSessions();
		await actions.setContextTab('unstaged');
	},

	// Refresh the active repo's session-count badge (cheap, tab-independent).
	async refreshSessionCount(): Promise<void> {
		await refreshSessionCount();
	},

	// Fired by the fs watcher when a repo's sessions change on disk (an agent's
	// CLI save, a purge, or another window). Keeps the badge live always, and
	// reloads the full list when the Sessions tab is the one on screen.
	async onSessionsChanged(repoId: string): Promise<void> {
		if (app.activeRepo?.id !== repoId) return;
		await refreshSessionCount();
		if (app.contextTab === 'sessions') await actions.loadSessions();
	},

	// Load the viewed branch/PR head's commit list into `app.commits`. Called on
	// entering the History tab and on refresh, so a fresh commit (or a checkout to
	// another branch) shows up. An open commit stays open — its SHA resolves
	// regardless of what the refreshed list now holds.
	async loadCommits(): Promise<void> {
		if (!app.activeRepo) {
			app.commits = [];
			app.historyForkPoint = null;
			return;
		}
		const repoId = app.activeRepo.id;
		const head = historyHeadRef();
		const baseRef = branchDiffBaseRef();
		const commits = await window.api.git.listCommits(repoId, head);
		// Bail if the user switched repos / views while we were fetching.
		if (!app.activeRepo || app.activeRepo.id !== repoId) return;
		app.commits = commits;
		app.historyForkPoint = null;
		// Mark where this head diverged from its base. Skip when the base is the
		// head itself (e.g. viewing the default branch) — there's nothing to fork
		// from. The merge-base is reachable from head, so it sits somewhere in the
		// list; only mark divergence when it's below the tip (there are
		// branch-unique commits above it).
		if (baseRef && baseRef !== head) {
			const sha = await window.api.git.mergeBase(repoId, baseRef, head);
			if (!app.activeRepo || app.activeRepo.id !== repoId) return;
			if (sha && commits[0]?.hash !== sha && commits.some((c) => c.hash === sha)) {
				const pr = uiPR();
				const baseLabel = pr && baseRef === `pr/${pr.number}/base` ? pr.baseRef : baseRef;
				app.historyForkPoint = { sha, baseLabel };
			}
		}
	},

	// Open a commit's diff: drives the file list + diff view through a `commit`
	// DiffContext (the commit against its first parent), the same way the Branch
	// tab drives a base/head diff. Swaps the commit list for the commit's files.
	async openCommit(commit: CommitInfo): Promise<void> {
		app.activeCommit = commit;
		app.diffContext = { kind: 'commit', ref: commit.hash };
		app.activePR = null;
		app.prComments = {};
		app.pendingComposers = {};
		app.localComposers = {};
		// The file search query carries no meaning into a freshly opened commit.
		app.fileSearchQuery = '';
		await refreshFiles();
	},

	// Leave an open commit and return to the commit list.
	closeCommit(): void {
		app.activeCommit = null;
		app.changedFiles = [];
		app.selectedFile = null;
		app.seenFiles = new SvelteSet();
		app.collapsedFiles = new SvelteSet();
		app.localComments = [];
		app.localComposers = {};
		app.localCommentsContextKey = null;
		app.diffContext = { kind: 'workingTree' };
	},

	// Re-check whether the super-review skill is installed in the active repo
	// (e.g. after the repo's `.agents/skills` dir may have changed on disk).
	async refreshSkillInstalled(): Promise<void> {
		await refreshSkillInstalled();
	},

	// Install the super-review skill into the active repo, then re-check so
	// the "Install skill" prompts clear once it's in place.
	async installSkill(): Promise<void> {
		if (!app.activeRepo) return;
		try {
			await window.api.skill.install(app.activeRepo.id);
			await refreshSkillInstalled();
			// Installing writes the skill files into the working tree — surface them
			// as unstaged changes right away instead of waiting for the next poll.
			await refreshFiles();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	async selectFile(path: string): Promise<void> {
		app.selectedFile = path;
	},

	scrollToFile(path: string): void {
		app.selectedFile = path;
		// Opening a file should reveal its diff — expand the section if it was
		// collapsed so the user isn't taken to a hidden body.
		if (app.collapsedFiles.has(path)) void actions.toggleFileCollapsed(path, false);
		app.scrollRequest = { path, nonce: (app.scrollRequest?.nonce ?? 0) + 1 };
	},

	// Land the diff view on the first file with a visible (non-collapsed) diff.
	// Called when opening a tab so the reviewer starts on real content instead of
	// a run of collapsed, already-seen headers. No-op when the list is empty or
	// every file is collapsed (nothing to read — stay put at the top).
	scrollToFirstExpanded(): void {
		const first = app.changedFiles.find((f) => !app.collapsedFiles.has(f.path));
		if (first) actions.scrollToFile(first.path);
	},

	// The diff scroll handler calls this as file sections cross the viewport top.
	// The active file always tracks the scroll. A single (or empty) selection is
	// really just "the file you're looking at", so we keep it glued to the active
	// file — that's what stops a plain click from leaving a stale second highlight
	// once you scroll past it. A deliberate multi-selection (2+ files) is left
	// alone so it stays put while you scroll through it; only the active marker
	// (the left border) moves.
	setActiveFromScroll(path: string): void {
		if (app.selectedFile === path) return;
		app.selectedFile = path;
		if (app.selectedFiles.size <= 1) app.selectedFiles = new SvelteSet([path]);
	},

	// The diff scroll handler reports the file at the top of the viewport and how
	// far its section's top sits above the container top, so we can put the
	// reviewer back exactly here after a refresh or a tab round-trip. Mirror it
	// into the per-context cache too, since that's what a later tab switch reads.
	recordScrollAnchor(path: string, offset: number): void {
		const anchor: ScrollAnchor = { path, offset };
		app.scrollAnchor = anchor;
		if (!app.activeRepo) return;
		const entry = filesCache.get(
			filesCacheKey(app.activeRepo.id, $state.snapshot(app.diffContext) as DiffContext)
		);
		if (entry) entry.scrollAnchor = anchor;
	},

	// Scroll the diff view to a tour step's header (Sessions tab).
	scrollToStep(stepId: string): void {
		app.scrollRequest = { stepId, nonce: (app.scrollRequest?.nonce ?? 0) + 1 };
	},

	// Scroll the diff to a specific callout. The owning file section brings
	// itself into view and aligns to the callout's note once it has rendered.
	// `selectedFile` is set so the sidebar highlights the right file too.
	scrollToCallout(filePath: string, calloutId: string): void {
		app.selectedFile = filePath;
		app.scrollRequest = {
			path: filePath,
			calloutId,
			nonce: (app.scrollRequest?.nonce ?? 0) + 1
		};
	},

	// Collapse the sidebar multi-selection to a single file and open its diff.
	// Used by plain clicks and keyboard navigation, which always reduce to one.
	selectOnly(path: string): void {
		app.selectedFiles = new SvelteSet([path]);
		actions.scrollToFile(path);
	},

	// Replace the multi-selection with exactly these paths (range select). Does
	// not change which file's diff is open — the caller decides that.
	setSelectedFiles(paths: string[]): void {
		app.selectedFiles = new SvelteSet(paths);
	},

	// Add or remove a single file from the multi-selection (cmd/ctrl-click).
	toggleSelectedFile(path: string): void {
		if (app.selectedFiles.has(path)) app.selectedFiles.delete(path);
		else app.selectedFiles.add(path);
	},

	clearSelectedFiles(): void {
		if (app.selectedFiles.size > 0) app.selectedFiles.clear();
	},

	toggleFolder(path: string): void {
		if (app.collapsedFolders.has(path)) app.collapsedFolders.delete(path);
		else app.collapsedFolders.add(path);
	},

	async toggleViewMode(): Promise<void> {
		app.viewMode = app.viewMode === 'split' ? 'unified' : 'split';
		app.prefs = await window.api.state.setPrefs({ viewMode: app.viewMode });
	},

	async toggleSeen(filePath: string, seen?: boolean): Promise<void> {
		if (!app.activeRepo) return;
		const next = seen ?? !app.seenFiles.has(filePath);
		// Was the branch already fully reviewed before this toggle? If not and this
		// toggle completes it, arm the celebration's entrance animation. Doing it
		// here (rather than reacting to `allBranchChangesSeen()` flipping true) is
		// what keeps the animation tied to *finishing* — switching back to an
		// already-finished branch never runs through here, so it stays instant.
		const wasComplete = allBranchChangesSeen();
		// `seenFiles` is a SvelteSet, so the in-place mutation is reactive.
		if (next) app.seenFiles.add(filePath);
		else app.seenFiles.delete(filePath);
		if (!wasComplete && allBranchChangesSeen()) app.seenItAllAnimate = true;
		// Stamp the file's current content signature when marking it seen so a later
		// change (new commits, more edits) can clear the mark on refresh.
		const file = app.changedFiles.find((f) => f.path === filePath);
		const sig = next && file ? fileContentSig(file) : undefined;
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		await window.api.state.setFileSeen(
			app.activeRepo.id,
			reviewContextKey(ctx),
			filePath,
			next,
			sig
		);
	},

	// The changed files in the order the user is currently viewing them: filtered
	// by the sidebar search, and in a session's Tour view reordered into the
	// agent's reading order. Both "Mark seen" affordances step along this order so
	// "next" matches what's actually on screen rather than the raw list.
	displayedFiles(): ChangedFile[] {
		const q = app.fileSearchQuery.trim().toLowerCase();
		const visible = q
			? app.changedFiles.filter((f) => f.path.toLowerCase().includes(q))
			: app.changedFiles;
		return app.sessionView === 'tour'
			? (tourFileOrder(app.activeSessionDetail, visible) ?? visible)
			: visible;
	},

	// Mark a file seen, collapse it, and open the next unseen file in display
	// order. Shared by the diff section's "Mark seen" button and the
	// Cmd/Ctrl+Enter hotkey so both walk through changes identically. Marking is
	// forced on (not toggled) so re-pressing the hotkey keeps advancing instead
	// of un-marking. Already-seen files are skipped so the walk lands on the next
	// thing that still needs review rather than re-opening a file the user (or
	// agent) has already cleared.
	async markSeenAndAdvance(filePath: string): Promise<void> {
		if (!app.activeRepo) return;
		// toggleSeen mutates app.seenFiles synchronously before its first await, so
		// the just-marked file is already in the set when we scan for the next one.
		void actions.toggleSeen(filePath, true);
		// Collapse so the next file's header slides up under the cursor before the
		// scroll request pins it at the top.
		void actions.toggleFileCollapsed(filePath, true);
		const ordered = actions.displayedFiles();
		const idx = ordered.findIndex((f) => f.path === filePath);
		const isUnseen = (f: ChangedFile): boolean => !app.seenFiles.has(f.path);
		// Advance to the next unseen file below; if nothing remains below (e.g. the
		// last file, or a tail of already-seen files), wrap to the first unseen file
		// above instead of stranding the reviewer here. Without the wrap, marking
		// the last file seen left the diff parked while only the sidebar's active
		// highlight moved.
		const next =
			idx >= 0
				? (ordered.slice(idx + 1).find(isUnseen) ?? ordered.slice(0, idx).find(isUnseen))
				: ordered.find(isUnseen);
		if (!next) return;
		// In a tour, when the next unseen file opens a new step, land on that step's
		// header (title + body) rather than scrolling straight to the file. Otherwise
		// "mark seen" leaps over the step commentary and the reviewer never sees the
		// description of what's coming. The file sits just below the header.
		const detail = app.activeSessionDetail;
		const lead =
			app.sessionView === 'tour' && detail
				? tourGroups(detail, ordered)?.find((g) => g.files[0]?.path === next.path)
				: undefined;
		if (lead) {
			app.selectedFile = next.path;
			if (app.collapsedFiles.has(next.path)) void actions.toggleFileCollapsed(next.path, false);
			actions.scrollToStep(lead.id);
		} else {
			actions.scrollToFile(next.path);
		}
	},

	async clearSeen(): Promise<void> {
		if (!app.activeRepo) return;
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		await window.api.state.clearSeen(app.activeRepo.id, reviewContextKey(ctx));
		app.seenFiles.clear();
	},

	// Hide the "You've seen it all" completion state ("Keep Reviewing"). It stays
	// hidden until the branch drops below fully-seen and is completed again. That
	// reset happens reactively in DiffView, keyed off `allBranchChangesSeen()`.
	dismissSeenItAll(): void {
		app.seenItAllDismissed = true;
	},
	resetSeenItAll(): void {
		if (app.seenItAllDismissed) app.seenItAllDismissed = false;
		if (app.seenItAllAnimate) app.seenItAllAnimate = false;
	},

	// Toggle whether a working-tree file is included in the next commit. The file
	// checkbox is a master toggle, so it also clears any partial (line/hunk)
	// selection on the file. Kept in memory only — the selection resets when the
	// repo changes or a file leaves the working tree (see refreshFiles /
	// switchRepo).
	toggleFileIncludedForCommit(filePath: string, included?: boolean): void {
		const isIncluded = included ?? app.excludedFromCommit.has(filePath);
		clearFileLineExclusions([filePath]);
		if (isIncluded) app.excludedFromCommit.delete(filePath);
		else app.excludedFromCommit.add(filePath);
	},

	// The header "select all" checkbox. Clearing the exclusion sets includes
	// everything; excluding every current file unchecks the lot. Either way any
	// partial selections are dropped.
	setAllIncludedForCommit(included: boolean): void {
		app.stagingLineExclusions = new SvelteSet();
		if (included) app.excludedFromCommit.clear();
		else app.excludedFromCommit = new SvelteSet(app.changedFiles.map((f) => f.path));
	},

	// Include/exclude a whole set of files at once — backs the folder checkboxes
	// in tree view, which check/uncheck every file beneath them. Clears partial
	// selections on the affected files.
	setFilesIncludedForCommit(paths: string[], included: boolean): void {
		clearFileLineExclusions(paths);
		for (const p of paths) {
			if (included) app.excludedFromCommit.delete(p);
			else app.excludedFromCommit.add(p);
		}
	},

	// The staging state of a working-tree file: 'all' (fully included, the
	// default), 'none' (whole-file checkbox off), or 'partial' (some lines/hunks
	// excluded). Drives the tri-state file checkbox.
	fileStagingState(filePath: string): 'all' | 'none' | 'partial' {
		if (app.excludedFromCommit.has(filePath)) return 'none';
		for (const k of app.stagingLineExclusions) {
			if (pathFromLineKey(k) === filePath) return 'partial';
		}
		return 'all';
	},

	// Whether a single changed line will be part of the next commit. A line is
	// in unless either its file or the line itself is excluded.
	isLineIncludedForCommit(filePath: string, side: DiffSide, line: number): boolean {
		if (app.excludedFromCommit.has(filePath)) return false;
		return !app.stagingLineExclusions.has(stagingLineKey(filePath, side, line));
	},

	// Include or exclude a set of changed lines (one line, a whole hunk, or all
	// of a file). `allFileLineKeys` is every changed-line key in the file, used
	// to reconcile with the whole-file checkbox: a fully-excluded file is first
	// "exploded" into per-line exclusions so an individual line can be turned
	// back on, and the file collapses back to a clean all/none state once every
	// or no line is excluded.
	setLinesIncludedForCommit(
		filePath: string,
		lineKeys: string[],
		included: boolean,
		allFileLineKeys: string[]
	): void {
		if (app.excludedFromCommit.has(filePath)) {
			app.excludedFromCommit.delete(filePath);
			for (const k of allFileLineKeys) app.stagingLineExclusions.add(k);
		}
		for (const k of lineKeys) {
			if (included) app.stagingLineExclusions.delete(k);
			else app.stagingLineExclusions.add(k);
		}
		const excludedCount = allFileLineKeys.filter((k) => app.stagingLineExclusions.has(k)).length;
		if (excludedCount === 0) {
			// Fully included again — nothing partial to track.
			return;
		}
		if (excludedCount === allFileLineKeys.length) {
			// Every line excluded: collapse to a whole-file exclusion so the file
			// checkbox reads as a clean "unchecked" rather than indeterminate.
			for (const k of allFileLineKeys) app.stagingLineExclusions.delete(k);
			app.excludedFromCommit.add(filePath);
		}
	},

	async toggleFileCollapsed(filePath: string, collapsed?: boolean): Promise<void> {
		if (!app.activeRepo) return;
		const next = collapsed ?? !app.collapsedFiles.has(filePath);
		if (next) app.collapsedFiles.add(filePath);
		else app.collapsedFiles.delete(filePath);
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		await window.api.state.setFileCollapsed(
			app.activeRepo.id,
			reviewContextKey(ctx),
			filePath,
			next
		);
	},

	async checkoutBranch(branch: string): Promise<boolean> {
		if (!app.activeRepo) return false;
		try {
			await window.api.git.checkout(app.activeRepo.id, branch);
			// Checking out makes the view follow the checkout again — drop any
			// read-only view so the UI reflects the branch now on disk.
			app.viewBranch = null;
			app.viewPR = null;
			// Checking out the default branch empties (and hides) the Branch tab, so
			// fall back to Unstaged rather than leaving a hidden tab selected.
			const landingOnDefault = branch === (app.activeRepo.defaultBranch ?? 'main');
			// Re-derive the diff context for tabs that depend on currentBranch.
			if (app.contextTab === 'branch' && !landingOnDefault) {
				app.diffContext = contextForTab('branch');
			}
			await Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()]);
			await refreshBranchPR();
			if (app.contextTab === 'history') {
				// The commit list follows the checked-out branch: drop any open commit
				// and reload for the new head.
				actions.closeCommit();
				await actions.loadCommits();
			}
			if (app.contextTab === 'branch' && landingOnDefault) {
				await actions.setContextTab('unstaged');
			}
			// Switching onto the default branch auto-refreshes it from upstream, so
			// `main` is never left stale after a switch (it's the branch you return to
			// expecting the latest). Fire-and-forget: pull() drives its own progress and
			// conflict UI (intent 'pull'), so we don't block the checkout on a network
			// round-trip. Guarded on an upstream existing (refreshPushStatus just ran)
			// so a local-only default branch doesn't error on a pull with no remote.
			if (landingOnDefault && app.pushStatus?.hasUpstream) {
				void actions.pull();
			}
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
		}
	},

	// Review a branch's committed state read-only, without checking it out — the
	// working tree stays on whatever's checked out, so an agent (or your own
	// in-progress work) on another branch is never disturbed. Files are read from
	// git refs via the existing `branch` diff context. The Unstaged tab is hidden
	// while a read-only view is active (no working tree to commit against), so we
	// move off it onto the Branch tab. Sessions are committed into the branch, so
	// the Sessions tab re-targets the viewed branch's committed sessions too.
	async viewBranchReadOnly(branch: string): Promise<void> {
		if (!app.activeRepo) return;
		// Viewing the already-checked-out branch is just "return home".
		if (branch === app.currentBranch) {
			await actions.returnToCheckedOutBranch();
			return;
		}
		if (app.viewBranch === branch) return;
		app.viewBranch = branch;
		// Entering a branch view supersedes any PR view.
		app.viewPR = null;
		// Resolve this branch's PR (best-effort, async) so the header's PR button
		// follows the view rather than the checked-out branch. Reset first so a
		// previous view's PR doesn't linger while the lookup is in flight.
		app.viewBranchPR = null;
		void resolveViewBranchPR(branch);
		if (app.contextTab === 'unstaged') {
			applyContextTab('branch');
		}
		if (app.contextTab === 'branch') {
			app.diffContext = contextForTab('branch');
			// Show any cached file list for this branch instantly; on a miss, show a
			// loading state instead of the previous branch's stale diff.
			if (!hydrateFilesFromCache()) showLoadingFiles();
		}
		// Sessions follow the viewed branch (read from its ref): refresh the badge
		// always; reload the on-screen list, which re-opens the active session
		// against the viewed ref or drops it when that branch doesn't have it.
		void refreshSessionCount();
		if (app.contextTab === 'sessions') {
			await actions.loadSessions();
		} else if (app.contextTab === 'history') {
			// History follows the viewed branch: drop any open commit (it belonged to
			// the previous view) and reload the list for the new head.
			actions.closeCommit();
			await actions.loadCommits();
		} else {
			await refreshFiles();
		}
	},

	// Review a pull request read-only, without checking out its head branch. We
	// fetch the PR's head ref (and base) into local refs and show it on the
	// Branch tab against the default branch — the same diff a checkout would
	// produce, but the working tree is untouched. Mirrors `viewBranchReadOnly`:
	// the Unstaged tab hides and the Sessions tab re-targets the PR's sessions.
	async viewPRReadOnly(pr: PRSummary): Promise<void> {
		if (!app.activeRepo) return;
		if (app.viewPR?.number === pr.number) return;
		// Show the loading state up front — fetching the PR ref is a network round
		// trip, so without this the previous diff would sit there looking frozen
		// for the whole fetch. (The Sessions tab reloads once the ref is fetched.)
		if (app.contextTab !== 'sessions') showLoadingFiles();
		try {
			// `pr` is a $state proxy; snapshot so it survives the IPC structured
			// clone and so the stored value is a plain object.
			const snapshot = $state.snapshot(pr) as PRSummary;
			// Fetch pr/<n>/head (+ base) without checking anything out.
			await window.api.github.fetchPR(app.activeRepo.id, pr.number, ...prHostArgs(snapshot));
			if (!app.activeRepo) return;
			// fetchPR pinned pr/<n>/base; record it so branchDiffBaseRef diffs the PR
			// head against its real base rather than the local default branch.
			app.fetchedPRBases.add(pr.number);
			app.viewPR = snapshot;
			app.viewBranch = null;
			if (app.contextTab === 'unstaged') {
				applyContextTab('branch');
			}
			if (app.contextTab === 'branch') {
				app.diffContext = contextForTab('branch');
				hydrateFilesFromCache();
			}
			// The PR's head ref is now fetched, so its committed sessions are
			// readable: refresh the badge and reload the on-screen list.
			void refreshSessionCount();
			if (app.contextTab === 'sessions') {
				await actions.loadSessions();
			} else if (app.contextTab === 'history') {
				// History follows the viewed PR head: drop any open commit and reload
				// the list now that the PR's head ref is fetched.
				actions.closeCommit();
				await actions.loadCommits();
			} else {
				await refreshFiles();
			}
		} catch (err) {
			// Clear the loading flag we set above so the view doesn't spin forever.
			app.loading.files = false;
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// Stop the read-only view (branch or PR) and follow the checked-out branch
	// again. The Unstaged tab reappears; the Branch diff re-targets the checkout.
	async returnToCheckedOutBranch(): Promise<void> {
		if (app.viewBranch == null && app.viewPR == null) return;
		app.viewBranch = null;
		app.viewPR = null;
		// Sessions follow the checked-out branch (working tree) again now the view
		// is dropped: refresh the badge always, reload the list when it's on screen.
		void refreshSessionCount();
		if (app.contextTab === 'sessions') {
			await actions.loadSessions();
			return;
		}
		if (app.contextTab === 'history') {
			// Back to the checked-out branch: drop any open commit and reload the
			// list for the checkout's head.
			actions.closeCommit();
			await actions.loadCommits();
			return;
		}
		// Dropping the read-only view may land us back on a plain default-branch
		// checkout, where the Branch tab is empty and hidden — fall back to Unstaged.
		if (app.contextTab === 'branch' && !canViewBranchTab()) {
			await actions.setContextTab('unstaged');
			return;
		}
		if (app.contextTab === 'branch') {
			app.diffContext = contextForTab('branch');
		}
		await refreshFiles();
	},

	// User-initiated branch switch (the branch picker). With a clean tree this is
	// just `checkoutBranch`; with a dirty tree we open SwitchBranchDialog to ask
	// whether to leave the in-progress work behind (stashed on the current branch)
	// or bring it along to `target`. No-op when already on `target`.
	async requestBranchSwitch(target: string): Promise<void> {
		if (!app.activeRepo || target === app.currentBranch) return;
		const dirty = await window.api.git.isDirty(app.activeRepo.id).catch(() => false);
		if (dirty) {
			app.switchBranchPrompt = { target };
		} else {
			await actions.checkoutBranch(target);
		}
	},

	dismissSwitchPrompt(): void {
		app.switchBranchPrompt = null;
	},

	// "Leave my changes on <current>": stash the in-progress work on the branch
	// we're leaving (the existing "Stashed Changes" row handles restore/discard on
	// return — no auto-pop), then switch to the target.
	async confirmLeaveAndSwitch(): Promise<void> {
		const prompt = app.switchBranchPrompt;
		if (!app.activeRepo || !prompt) return;
		const target = prompt.target;
		const repoId = app.activeRepo.id;
		app.switchBranchPrompt = null;
		try {
			const stashed = await window.api.git.createManagedStash(repoId);
			if (!stashed.ok) throw new Error(stashed.error ?? 'Could not stash your changes.');
			await actions.checkoutBranch(target);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// "Bring my changes to <target>": carry the in-progress work to the target.
	async confirmBringAndSwitch(): Promise<void> {
		const prompt = app.switchBranchPrompt;
		if (!prompt) return;
		const target = prompt.target;
		app.switchBranchPrompt = null;
		await actions.bringChangesToBranch(target);
	},

	// Stash the working tree on the current branch and stay put. Used by the
	// create-branch dialog's "leave" choice: the new branch was already created
	// (without checkout), so we just park the changes here — the "Stashed Changes"
	// row then appears for later restore.
	async stashChangesOnBranch(_branch: string): Promise<void> {
		if (!app.activeRepo || app.push.inProgress) return;
		const repoId = app.activeRepo.id;
		try {
			const stashed = await window.api.git.createManagedStash(repoId);
			if (!stashed.ok) throw new Error(stashed.error ?? 'Could not stash your changes.');
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// Carry the dirty working tree from the current branch onto `target`: park it
	// in a managed stash, switch, then pop it on the far side. A conflicted pop
	// reuses the shared stash-restore conflict flow (continueMerge/abortMerge wrap
	// it up). Shared by the switch-branch and create-branch "bring" choices.
	async bringChangesToBranch(target: string): Promise<void> {
		if (!app.activeRepo || app.push.inProgress) return;
		const repoId = app.activeRepo.id;

		// Park the dirty work and resolve it to a stable SHA while we're still on
		// the source branch (the stash is keyed to that branch), then switch. Bail
		// cleanly if any step fails.
		let ref: string;
		let fileCount: number;
		try {
			const stashed = await window.api.git.createManagedStash(repoId);
			if (!stashed.ok) throw new Error(stashed.error ?? 'Could not stash your changes.');
			const found = await window.api.git.findManagedStash(repoId);
			if (!found) {
				// createManagedStash keys off the current branch, so a second stash
				// can't be told apart from a pre-existing one (findManagedStash wants
				// exactly one). v1: surface it rather than risk popping the wrong one.
				throw new Error(
					'Could not bring your changes over. This branch already has stashed changes.'
				);
			}
			ref = found.ref;
			fileCount = found.fileCount;
			await window.api.git.checkout(repoId, target);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return;
		}

		// On `target` now (the stash left the tree clean) — land the UI there
		// before popping the carried-over work.
		if (app.contextTab === 'branch') {
			app.diffContext = contextForTab('branch');
		}
		await Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()]);
		await refreshBranchPR();

		// Pop the stash onto the target, reusing the stash-restore conflict flow so
		// a conflicted pop opens the shared dialog (continue/abort finish/abort it).
		app.push = {
			inProgress: true,
			stage: 'pulling',
			intent: 'stash-restore',
			op: 'stash-restore',
			error: null
		};
		clearConflicts();
		try {
			const result = await window.api.git.restoreManagedStash(repoId, ref);
			if (!result.ok) {
				if (result.conflicts.length > 0) {
					setConflicts(result.conflicts);
					// The conflicted pop kept the stash entry; point app.stash at it so
					// the dialog's continue/abort can finish or abort the pop by ref.
					// Also pin the ref on push state — we're now on `target`, so a
					// focus/poll refreshStash would null app.stash (the entry is still
					// marked for the source branch) and strand continueMerge.
					app.stash = { ref, fileCount };
					app.push.stashRef = ref;
					app.push.stage = 'conflicts';
					return;
				}
				throw new Error(result.error ?? 'Could not bring your changes over.');
			}
			// Clean pop: the entry is gone and the work now lives in target's tree.
			app.stash = null;
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshPushStatus()]);
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error);
			await Promise.all([refreshFiles(), refreshPushStatus()]);
		} finally {
			if (app.push.stage !== 'conflicts') {
				app.push.inProgress = false;
			}
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
		if (!app.activeRepo || app.loading.prs || app.loadingMorePRs || !app.prsHasMore) {
			return;
		}
		const repoId = app.activeRepo.id;
		const source = app.prsSource;
		const next = prsPage + 1;
		app.loadingMorePRs = true;
		try {
			const page = await window.api.github.listPRs(repoId, next, source);
			if (app.activeRepo?.id !== repoId || app.prsSource !== source) return;
			app.prs = appendUniquePRs(app.prs, page);
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
			await window.api.git.checkoutPR(app.activeRepo.id, $state.snapshot(pr), app.prsSource);
			app.viewBranch = null;
			app.viewPR = null;
			applyContextTab('branch');
			await refreshBranches();
			app.diffContext = contextForTab('branch');
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
			// Cache the PR summary so we have headSha for comment posting — and its
			// host (base) repo, so an upstream PR's head/base are fetched from the
			// parent rather than the fork.
			const summary = app.prs.find((p) => p.number === prNumber) ?? null;
			const host = prHostArgs(summary);
			await window.api.github.fetchPR(app.activeRepo.id, prNumber, ...host);
			app.fetchedPRBases.add(prNumber);
			app.activePR =
				summary ?? (await window.api.github.getPR(app.activeRepo.id, prNumber, ...host));
			app.prComments = {};
			app.prConversation = [];
			app.prConversationLoadedFor = null;
			app.pendingComposers = {};
			await actions.setDiffContext({ kind: 'pr', prNumber });
			void actions.refreshPRComments();
			// If the sidebar is already parked on the Conversation tab, load it now so
			// switching PRs doesn't leave a stale/empty feed until the tab is re-clicked.
			if (app.commentsSidebarOpen && app.commentsSidebarTab === 'conversation') {
				void actions.refreshPRConversation();
			}
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
				...host
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

	// ─── PR conversation (Conversation tab) ────────────────────────────────────

	// Fetch the active PR's top-level conversation timeline. Lazy: callers gate on
	// staleness so we don't hit the API for users who never open the tab. Marks the
	// loaded PR so a later context switch can tell the cached feed is stale.
	async refreshPRConversation(): Promise<void> {
		if (!app.activeRepo) return;
		const prNumber = commentablePRNumber();
		if (prNumber == null) return;
		const host = prHostArgs(commentablePR());
		app.loadingConversation = true;
		try {
			const items = await window.api.github.listConversation(app.activeRepo.id, prNumber, ...host);
			app.prConversation = items;
			app.prConversationLoadedFor = prNumber;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			app.loadingConversation = false;
		}
	},

	// Load the conversation if it hasn't been loaded for the current PR yet. Called
	// when the Conversation tab becomes visible so its data arrives on demand.
	ensurePRConversationLoaded(): void {
		const prNumber = commentablePRNumber();
		if (prNumber == null) return;
		if (app.loadingConversation) return;
		if (app.prConversationLoadedFor === prNumber) return;
		void actions.refreshPRConversation();
	},

	// Post a top-level comment to the PR conversation. Appends optimistically on
	// success (the created item comes back from GitHub) rather than refetching the
	// whole timeline. Returns true so the composer can clear itself.
	async postConversationComment(body: string): Promise<boolean> {
		if (!app.activeRepo) return false;
		const prNumber = commentablePRNumber();
		if (prNumber == null) return false;
		const trimmed = body.trim();
		if (!trimmed) return false;
		const host = prHostArgs(commentablePR());
		try {
			const created = await window.api.github.createIssueComment(
				app.activeRepo.id,
				prNumber,
				trimmed,
				...host
			);
			app.prConversation = [...app.prConversation, created];
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err), 'Posting a conversation comment');
			return false;
		}
	},

	// Delete one of the viewer's own conversation comments. Optimistic with
	// rollback, mirroring deleteComment for review comments.
	async deleteConversationComment(commentId: number): Promise<void> {
		if (!app.activeRepo) return;
		const prev = app.prConversation;
		app.prConversation = prev.filter((i) => !(i.kind === 'comment' && i.id === commentId));
		try {
			await window.api.github.deleteIssueComment(
				app.activeRepo.id,
				commentId,
				...prHostArgs(commentablePR())
			);
		} catch (err) {
			app.prConversation = prev;
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// Edit a conversation comment's body — both the explicit "Edit" action and a
	// task-list checkbox toggle route through here. Optimistic, reconciling to the
	// body GitHub returns. Returns true on success so the editor can close.
	async editConversationComment(commentId: number, body: string): Promise<boolean> {
		if (!app.activeRepo) return false;
		const prev = app.prConversation;
		app.prConversation = prev.map((i) =>
			i.kind === 'comment' && i.id === commentId ? { ...i, body } : i
		);
		try {
			const saved = await window.api.github.updateIssueComment(
				app.activeRepo.id,
				commentId,
				body,
				...prHostArgs(commentablePR())
			);
			app.prConversation = app.prConversation.map((i) =>
				i.kind === 'comment' && i.id === commentId ? { ...i, body: saved } : i
			);
			return true;
		} catch (err) {
			app.prConversation = prev;
			setError(err instanceof Error ? err.message : String(err));
			return false;
		}
	},

	// Edit the PR description (body) — the description card's edit and its task-list
	// checkbox toggles. Updates whichever summary holds the PR (activePR in a PR
	// view, branchPR on the Branch tab). Optimistic with rollback.
	async editPRDescription(body: string): Promise<boolean> {
		if (!app.activeRepo) return false;
		const prNumber = commentablePRNumber();
		if (prNumber == null) return false;
		const prevActive = app.activePR;
		const prevBranch = app.branchPR;
		if (app.activePR) app.activePR = { ...app.activePR, body };
		if (app.branchPR && app.branchPR.number === prNumber) {
			app.branchPR = { ...app.branchPR, body };
		}
		try {
			const saved = await window.api.github.updatePullRequestBody(
				app.activeRepo.id,
				prNumber,
				body,
				...prHostArgs(commentablePR())
			);
			if (app.activePR) app.activePR = { ...app.activePR, body: saved };
			if (app.branchPR && app.branchPR.number === prNumber) {
				app.branchPR = { ...app.branchPR, body: saved };
			}
			return true;
		} catch (err) {
			app.activePR = prevActive;
			app.branchPR = prevBranch;
			setError(err instanceof Error ? err.message : String(err));
			return false;
		}
	},

	// ─── Merge box (Conversation tab) ──────────────────────────────────────────

	// Load the merge box (mergeability) for the panel's PR if we don't already
	// have it. Called when the Conversation tab is shown / the PR changes; gated
	// on PR number so re-renders don't refetch. `refreshMergeBox` also kicks the
	// shared `prChecks` fetch, so the panel's CI rows fill in on open too.
	ensureMergeBox(prNumber: number): void {
		if (app.loadingMergeBox) return;
		if (app.mergeBox?.number === prNumber) return;
		void refreshMergeBox();
	},

	// Force a merge-box refetch (e.g. after a merge / ready action).
	async refreshMergeBox(): Promise<void> {
		await refreshMergeBox();
	},

	// Poll the merge box's mergeability so the Conversation tab stays current while
	// GitHub recomputes it. Gated on the Conversation tab actually being shown
	// (sidebar tab or fullscreen) so we don't fetch getPR when nobody's looking.
	// Checks aren't polled here — they ride the always-on `refreshPrChecks` poll.
	pollMergeBox(): void {
		if (!app.mergeBox) return;
		const showing =
			app.conversationFullscreen ||
			(app.commentsSidebarOpen && effectiveCommentsSidebarTab() === 'conversation');
		if (!showing) return;
		void refreshMergeBox();
	},

	// Merge the panel's PR with the chosen method. Returns true on success. On a
	// soft refusal (GitHub returns merged:false) or error, surfaces the message
	// and leaves the box as-is.
	async mergePullRequest(
		method: PRMergeMethod,
		commitTitle?: string,
		commitMessage?: string
	): Promise<boolean> {
		if (!app.activeRepo) return false;
		const pr = mergeBoxPR();
		if (!pr) return false;
		app.mergeBoxBusy = 'merge';
		try {
			const res = await window.api.github.mergePullRequest(
				app.activeRepo.id,
				pr.number,
				method,
				...prHostArgs(pr),
				commitTitle,
				commitMessage
			);
			if (!res.merged) {
				setError(res.message || 'GitHub declined to merge this pull request.');
				return false;
			}
			// Reflect the merge immediately, then refetch the authoritative status
			// and the conversation (so the "merged" event shows up).
			applyPRStatus({ ...pr, state: 'closed', merged: true });
			void refreshMergeBox();
			void actions.refreshPRConversation();
			// We caused this merge, so fire the switch-back flow now instead of
			// waiting for the next branch-PR poll to observe the transition. Disarm
			// the watcher first so that poll doesn't double-prompt for the same PR.
			if (watchedOpenPR && watchedOpenPR.number === pr.number) watchedOpenPR = null;
			void onBranchPRMerged(pr.headRef, pr.number, app.activeRepo.defaultBranch ?? 'main');
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err), 'Merging the pull request');
			return false;
		} finally {
			app.mergeBoxBusy = null;
		}
	},

	// Take the panel's draft PR out of draft ("Ready for review").
	async markPullRequestReady(): Promise<boolean> {
		if (!app.activeRepo) return false;
		const pr = mergeBoxPR();
		if (!pr) return false;
		app.mergeBoxBusy = 'ready';
		try {
			await window.api.github.markPullRequestReady(app.activeRepo.id, pr.number, ...prHostArgs(pr));
			applyPRStatus({ ...pr, draft: false });
			void refreshMergeBox();
			void actions.refreshPRConversation();
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
		} finally {
			app.mergeBoxBusy = null;
		}
	},

	openComposer(filePath: string, side: 'LEFT' | 'RIGHT', line: number, replyTo?: number): void {
		const key = composerKey(filePath, side, line);
		if (app.pendingComposers[key]) return;
		app.pendingComposers = {
			...app.pendingComposers,
			[key]: { filePath, line, side, replyTo, draft: '', submitting: false }
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
						...host
					)
				: await window.api.github.createReviewComment(
						app.activeRepo.id,
						{
							prNumber,
							path: c.filePath,
							line: c.line,
							side: c.side,
							body: c.draft.trim(),
							headRef: commentAnchorRef()
						},
						...host
					);
			const existing = app.prComments[c.filePath] ?? [];
			app.prComments = {
				...app.prComments,
				[c.filePath]: [...existing, created]
			};
			const { [key]: _done, ...rest } = app.pendingComposers;
			void _done;
			app.pendingComposers = rest;
			// The REST create response has no GraphQL `threadId`, so the new comment
			// isn't resolvable until we refetch the thread metadata. Do it in the
			// background so the comment shows instantly but becomes resolvable without
			// a manual refresh.
			void actions.refreshPRComments();
		} catch (err) {
			c.submitting = false;
			setError(err instanceof Error ? err.message : String(err), 'Submitting a review comment');
		}
	},

	// Post a reply to an existing thread directly from an inline input, without
	// going through the pendingComposer/annotation machinery — the inline reply
	// box stays put rather than swapping in a separate composer row. Returns true
	// on success so the caller can clear its input.
	async submitReply(filePath: string, replyTo: number, body: string): Promise<boolean> {
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
				...host
			);
			const existing = app.prComments[filePath] ?? [];
			app.prComments = {
				...app.prComments,
				[filePath]: [...existing, created]
			};
			// Refetch so the reply (and its thread) pick up the GraphQL `threadId`,
			// keeping the thread resolvable without a manual refresh.
			void actions.refreshPRComments();
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
				...prHostArgs(commentablePR())
			);
		} catch (err) {
			app.prComments = { ...app.prComments, [filePath]: prev };
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// Edit one of the viewer's own review comments. Optimistic, reconciling to the
	// body GitHub returns. Only the body changes so the comment keeps its thread,
	// resolution and anchor state. Returns true on success so the editor can close.
	async editReviewComment(commentId: number, filePath: string, body: string): Promise<boolean> {
		if (!app.activeRepo) return false;
		const prev = app.prComments[filePath] ?? [];
		const apply = (newBody: string): PRReviewComment[] =>
			prev.map((c) => (c.id === commentId ? { ...c, body: newBody } : c));
		app.prComments = { ...app.prComments, [filePath]: apply(body) };
		try {
			const saved = await window.api.github.updateReviewComment(
				app.activeRepo.id,
				commentId,
				body,
				...prHostArgs(commentablePR())
			);
			app.prComments = { ...app.prComments, [filePath]: apply(saved) };
			return true;
		} catch (err) {
			app.prComments = { ...app.prComments, [filePath]: prev };
			setError(err instanceof Error ? err.message : String(err));
			return false;
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
				next[path] = list.map((c) => (c.threadId === threadId ? { ...c, isResolved: value } : c));
			}
			app.prComments = next;
		};
		apply(resolved);
		try {
			const res = await window.api.github.setReviewThreadResolved(
				app.activeRepo.id,
				threadId,
				resolved
			);
			// Reconcile if GitHub ended up in a different state than we assumed.
			if (res.isResolved !== resolved) apply(res.isResolved);
		} catch (err) {
			app.prComments = prev;
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// ─── Local comments ──────────────────────────────────────────────────────

	// Reload the active context's local comments (e.g. after the watcher fires).
	async loadLocalComments(): Promise<void> {
		await loadLocalComments();
	},

	// Fired by the fs watcher when a repo's comments change on disk (another
	// window adding one, or an agent resolving one via the CLI).
	async onCommentsChanged(repoId: string): Promise<void> {
		if (app.activeRepo?.id !== repoId) return;
		await loadLocalComments();
	},

	// Open an inline compose box for a new local comment at a line. No-op if one is
	// already open there (matches the PR composer's single-open-per-line rule).
	openLocalComposer(filePath: string, side: 'LEFT' | 'RIGHT', line: number): void {
		const key = composerKey(filePath, side, line);
		if (app.localComposers[key]) return;
		app.localComposers = {
			...app.localComposers,
			[key]: { filePath, line, side, draft: '', submitting: false }
		};
	},

	setLocalComposerDraft(key: string, draft: string): void {
		const c = app.localComposers[key];
		if (!c) return;
		// Mutate in place — same focus-stability rationale as setComposerDraft.
		c.draft = draft;
	},

	cancelLocalComposer(key: string): void {
		if (!app.localComposers[key]) return;
		const { [key]: _removed, ...rest } = app.localComposers;
		void _removed;
		app.localComposers = rest;
	},

	// Persist a new local comment from an open composer, then drop the composer and
	// merge the saved record into the list.
	async submitLocalComposer(key: string): Promise<void> {
		if (!app.activeRepo) return;
		const c = app.localComposers[key];
		if (!c || !c.draft.trim() || c.submitting) return;
		c.submitting = true;
		try {
			const created = await window.api.comments.add(app.activeRepo.id, {
				contextKey: localCommentContextKey(),
				path: c.filePath,
				side: c.side,
				startLine: c.line,
				endLine: c.line,
				body: c.draft.trim(),
				author: localAuthor()
			});
			app.localComments = [created, ...app.localComments];
			const { [key]: _done, ...rest } = app.localComposers;
			void _done;
			app.localComposers = rest;
		} catch (err) {
			c.submitting = false;
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// Mark a local comment resolved by the current (human) user. Optimistic, with
	// reconcile to the persisted record and rollback on failure.
	async resolveLocalComment(id: string): Promise<void> {
		if (!app.activeRepo) return;
		const prev = app.localComments;
		const resolver = localAuthor();
		const now = Date.now();
		app.localComments = prev.map((c) =>
			c.id === id ? { ...c, resolvedAt: now, resolvedBy: resolver, updatedAt: now } : c
		);
		try {
			const updated = await window.api.comments.resolve(app.activeRepo.id, id, resolver);
			if (updated) app.localComments = app.localComments.map((c) => (c.id === id ? updated : c));
		} catch (err) {
			app.localComments = prev;
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	async unresolveLocalComment(id: string): Promise<void> {
		if (!app.activeRepo) return;
		const prev = app.localComments;
		app.localComments = prev.map((c) =>
			c.id === id
				? { ...c, resolvedAt: undefined, resolvedBy: undefined, resolvedSessionId: undefined }
				: c
		);
		try {
			const updated = await window.api.comments.unresolve(app.activeRepo.id, id);
			if (updated) app.localComments = app.localComments.map((c) => (c.id === id ? updated : c));
		} catch (err) {
			app.localComments = prev;
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	async deleteLocalComment(id: string): Promise<void> {
		if (!app.activeRepo) return;
		const prev = app.localComments;
		app.localComments = prev.filter((c) => c.id !== id);
		try {
			await window.api.comments.remove(app.activeRepo.id, id);
		} catch (err) {
			app.localComments = prev;
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// Edit a local comment's body in place. Optimistic, with reconcile to the
	// persisted record and rollback on failure. Returns whether it succeeded so the
	// caller (the inline editor) can close only on success.
	async editLocalComment(id: string, body: string): Promise<boolean> {
		if (!app.activeRepo) return false;
		const trimmed = body.trim();
		if (!trimmed) return false;
		const prev = app.localComments;
		const now = Date.now();
		app.localComments = prev.map((c) =>
			c.id === id ? { ...c, body: trimmed, updatedAt: now } : c
		);
		try {
			const updated = await window.api.comments.edit(app.activeRepo.id, id, trimmed);
			if (updated) app.localComments = app.localComments.map((c) => (c.id === id ? updated : c));
			return true;
		} catch (err) {
			app.localComments = prev;
			setError(err instanceof Error ? err.message : String(err));
			return false;
		}
	},

	// Copy a single comment as an agent-ready prompt.
	async copyCommentPrompt(id: string): Promise<void> {
		const comment = app.localComments.find((c) => c.id === id);
		if (!comment) return;
		await actions.copyToClipboard(formatCommentPrompt(comment));
	},

	// Copy every unresolved comment in the active context as one markdown task list.
	async copyAllUnresolvedComments(): Promise<void> {
		const open = app.localComments.filter((c) => !c.resolvedAt);
		if (open.length === 0) return;
		await actions.copyToClipboard(formatCommentsPrompt(open));
	},

	// Open the session a resolved comment links to, so the reviewer can see how the
	// feedback was addressed. Switches to the Sessions tab and opens the tour.
	async openLinkedSession(sessionId: string): Promise<void> {
		applyContextTab('sessions');
		await actions.loadSessions();
		await actions.openSession(sessionId);
	},

	toggleCommentsSidebar(): void {
		// Opening always lands on the Comments tab (the Conversation tab has its own
		// hotkey). Closing leaves the remembered tab alone.
		if (!app.commentsSidebarOpen) actions.setCommentsSidebarTab('comments');
		actions.setCommentsSidebarOpen(!app.commentsSidebarOpen);
	},

	// Switch the sidebar's active tab, loading the Conversation feed on demand the
	// first time it's shown for the current PR. Persisted so the tab the user left
	// on reopens with the app.
	setCommentsSidebarTab(tab: 'comments' | 'conversation'): void {
		if (app.commentsSidebarTab !== tab) {
			app.commentsSidebarTab = tab;
			rememberViewLayout();
			void window.api.state.setPrefs({ commentsSidebarTab: tab }).then((prefs) => {
				app.prefs = prefs;
			});
		}
		if (tab === 'conversation') actions.ensurePRConversationLoaded();
	},

	// Open the sidebar straight to the Comments tab (default Cmd/Ctrl+L). Mirror
	// of openConversationSidebar: closes only when already parked on the Comments
	// tab, otherwise switches to it (opening if needed). The toggle-only feel
	// stays on the sidebar buttons (toggleCommentsSidebar); this is what lets
	// Ctrl+L pull you back from the Conversation tab instead of just dismissing.
	openCommentsSidebar(): void {
		if (app.commentsSidebarOpen && effectiveCommentsSidebarTab() === 'comments') {
			actions.setCommentsSidebarOpen(false);
			return;
		}
		actions.setCommentsSidebarTab('comments');
		if (!app.commentsSidebarOpen) actions.setCommentsSidebarOpen(true);
	},

	// Open the sidebar straight to the Conversation tab (default Cmd/Ctrl+Shift+L).
	// Toggles closed when it's already open on that tab, mirroring the Comments
	// hotkey's open/close feel.
	openConversationSidebar(): void {
		if (app.commentsSidebarOpen && app.commentsSidebarTab === 'conversation') {
			actions.setCommentsSidebarOpen(false);
			return;
		}
		actions.setCommentsSidebarTab('conversation');
		if (!app.commentsSidebarOpen) actions.setCommentsSidebarOpen(true);
	},

	setCommentsSidebarOpen(open: boolean): void {
		app.commentsSidebarOpen = open;
		// Closing the panel can't leave fullscreen dangling — there'd be nothing on
		// screen but a collapsed diff. Drop it (which also re-expands the diff).
		if (!open && app.conversationFullscreen) actions.setConversationFullscreen(false);
		rememberViewLayout();
		// Persist so the panel reopens (or stays closed) on the next launch.
		void window.api.state.setPrefs({ commentsSidebarOpen: open }).then((prefs) => {
			app.prefs = prefs;
		});
	},

	// Fullscreen the comments panel (collapse the diff pane to zero). Entering
	// fullscreen collapses the left sidebar automatically — that's driven by the
	// pane $effect in App.svelte, which closes the sidebar before collapsing the
	// diff. So the only requirement here is that the comments panel is actually
	// open. Idempotent so the $effect and the drag-to-collapse handler can both
	// route through it without ping-ponging.
	setConversationFullscreen(on: boolean): void {
		const next = on && app.commentsSidebarOpen;
		if (app.conversationFullscreen === next) return;
		app.conversationFullscreen = next;
		rememberViewLayout();
		void window.api.state.setPrefs({ conversationFullscreen: next }).then((prefs) => {
			app.prefs = prefs;
		});
	},

	toggleConversationFullscreen(): void {
		actions.setConversationFullscreen(!app.conversationFullscreen);
	},

	// Left file-list sidebar collapse state. Routed through here (rather than
	// assigning app.sidebarCollapsed directly) so every collapse/expand — button,
	// hotkey, or dragging the handle shut — persists for the next launch.
	setSidebarCollapsed(collapsed: boolean): void {
		app.sidebarCollapsed = collapsed;
		// Reopening the left sidebar exits fullscreen — the two can't coexist, since
		// fullscreen requires the sidebar to be out of the way.
		if (!collapsed && app.conversationFullscreen) actions.setConversationFullscreen(false);
		rememberViewLayout();
		void window.api.state.setPrefs({ sidebarCollapsed: collapsed }).then((prefs) => {
			app.prefs = prefs;
		});
	},

	// Ask the diff view to scroll a comment's inline annotation into view, and make
	// sure the sidebar is open so the two stay in step.
	revealComment(id: string): void {
		const comment = app.localComments.find((c) => c.id === id);
		if (!comment) return;
		app.selectedFile = comment.path;
		// Expand the file if it's collapsed, otherwise the diff (and the comment) is
		// hidden and scrolling lands on a collapsed header.
		if (app.collapsedFiles.has(comment.path)) void actions.toggleFileCollapsed(comment.path, false);
		const nonce = (app.commentScrollTarget?.nonce ?? 0) + 1;
		app.commentScrollTarget = { key: id, path: comment.path, nonce };
	},

	// ─── PR comments in the sidebar ────────────────────────────────────────────
	// When the diff on screen is a PR's, the Comments sidebar lists GitHub review
	// comments instead of local ones (the data already lives in app.prComments).

	// Copy a single PR review comment as an agent-ready prompt.
	async copyPRCommentPrompt(path: string, id: number): Promise<void> {
		const comment = (app.prComments[path] ?? []).find((c) => c.id === id);
		if (!comment) return;
		await actions.copyToClipboard(formatPRCommentPrompt(comment));
	},

	// Copy every actionable PR review thread (one entry per root comment) as a
	// markdown task list. Only unresolved threads still anchored to a live line
	// qualify: resolved threads are done, and outdated/file-level ones (no live
	// `line`) point at code the agent can no longer act on directly.
	async copyAllUnresolvedPRComments(): Promise<void> {
		const roots = Object.values(app.prComments)
			.flat()
			.filter((c) => c.inReplyTo == null && c.line != null && !c.isResolved);
		if (roots.length === 0) return;
		await actions.copyToClipboard(formatPRCommentsPrompt(roots));
	},

	// Scroll a PR review comment's inline thread into view (its annotation
	// container is keyed `pr-<id>` in the diff).
	revealPRComment(path: string, id: number): void {
		app.selectedFile = path;
		// Expand the file if collapsed so the inline thread is actually visible.
		if (app.collapsedFiles.has(path)) void actions.toggleFileCollapsed(path, false);
		// Force the thread open — resolved/outdated threads collapse by default, so
		// revealing one from the sidebar should always show the conversation rather
		// than land on a collapsed header.
		const rootId = (app.prComments[path] ?? []).find((c) => c.id === id)?.inReplyTo ?? id;
		app.commentCollapse.set(`pr-${rootId}`, false);
		const nonce = (app.commentScrollTarget?.nonce ?? 0) + 1;
		app.commentScrollTarget = { key: `pr-${id}`, path, nonce };
	},

	// Toggle a PR comment thread's collapsed state (keyed by its root), pinning the
	// choice against the resolved/outdated default.
	toggleThreadCollapsed(c: PRReviewComment): void {
		const rootId = c.inReplyTo ?? c.id;
		app.commentCollapse.set(`pr-${rootId}`, !prThreadCollapsed(c));
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
		// External edits (made while the app was unfocused) keep the same file in
		// the list but change its contents — nudge open diffs to re-validate.
		bumpDiffRevalidate();
		// On the Sessions tab, reload the manifests so an agent's CLI update lands
		// (loadSessions re-opens the active session if one is showing).
		if (app.contextTab === 'sessions') await actions.loadSessions();
		// On the History tab, reload the commit list so a fresh commit shows up.
		if (app.contextTab === 'history') await actions.loadCommits();
		await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
		await refreshBranchPR();
	},

	// Fetch origin in the background, then refresh. Reported failures don't
	// block the UI — many repos have no remote, or the user may be offline.
	async fetchAndRefresh(): Promise<void> {
		if (!app.activeRepo || app.fetchingOrigin) return;
		app.fetchingOrigin = true;
		// Same as refresh(): pick up out-of-app edits on open diffs.
		bumpDiffRevalidate();
		try {
			const result = await window.api.git.fetchOrigin(app.activeRepo.id);
			if (!result.ok && result.error) {
				// Don't show as user-facing error — surface only on explicit failures
				console.warn('fetchOrigin failed:', result.error);
			}
			// Mirror refresh(): on the Sessions tab, reload the manifests so an
			// agent's CLI update lands (loadSessions re-opens the active session).
			if (app.contextTab === 'sessions') await actions.loadSessions();
			// On the History tab, reload the commit list so a fresh commit shows up.
			if (app.contextTab === 'history') await actions.loadCommits();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
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

	openPublishDialog(): void {
		app.publishDialogOpen = true;
	},
	closePublishDialog(): void {
		app.publishDialogOpen = false;
	},

	openCreateBranchDialog(): void {
		// Snapshot the source branch now (on the open event) so the dialog's
		// "based on…" options don't react to the branch switch a checkout creation
		// performs mid-flow — see app.createBranchFrom.
		app.createBranchFrom = app.currentBranch ?? null;
		app.createBranchDialogOpen = true;
	},
	closeCreateBranchDialog(): void {
		app.createBranchDialogOpen = false;
		app.createBranchFrom = null;
	},

	openCleanupBranchesDialog(): void {
		app.cleanupBranchesDialogOpen = true;
	},
	closeCleanupBranchesDialog(): void {
		app.cleanupBranchesDialogOpen = false;
	},

	// Delete the chosen local-only branches in one pass (none of them is the
	// checked-out branch — listLocalOnlyBranches excludes it). `deleteRemote` is
	// always false: these branches have no live remote to clean up. We attempt
	// every branch, collect failures, then refresh once and surface a combined
	// error so one stuck branch doesn't abort the rest. Returns true when every
	// deletion succeeded.
	async cleanupLocalBranches(names: string[]): Promise<boolean> {
		if (!app.activeRepo || names.length === 0) return false;
		const repoId = app.activeRepo.id;
		const failures: string[] = [];
		for (const name of names) {
			try {
				const result = await window.api.git.deleteBranch(repoId, name, { deleteRemote: false });
				if (!result.ok) failures.push(`${name}: ${result.error ?? 'unknown error'}`);
			} catch (err) {
				failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		await Promise.all([refreshBranches(), refreshPushStatus()]);
		if (failures.length > 0) {
			setError(`Could not delete ${failures.length} branch(es):\n${failures.join('\n')}`);
			return false;
		}
		return true;
	},

	// Create a new branch. `checkout` decides whether we switch onto it as part
	// of creating it: true → `checkout -b` (the working tree follows along);
	// false → `git branch` (the branch is created but we stay put). The create
	// dialog creates without switching while the user is still deciding what to
	// do with a dirty working tree, then switches separately via checkoutBranch.
	async createBranch(name: string, opts: { base?: string; checkout: boolean }): Promise<boolean> {
		if (!app.activeRepo) return false;
		try {
			const result = await window.api.git.createBranch(app.activeRepo.id, name, {
				base: opts.base,
				checkout: opts.checkout
			});
			if (!result.ok) {
				setError(result.error ?? 'Could not create branch.');
				return false;
			}
			if (app.contextTab === 'branch') {
				app.diffContext = contextForTab('branch');
			}
			await Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()]);
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
	async deleteBranch(name: string, opts: { deleteRemote: boolean }): Promise<boolean> {
		if (!app.activeRepo) return false;
		const upstream = app.branches.find((b) => b.name === name)?.upstream;
		try {
			const result = await window.api.git.deleteBranch(app.activeRepo.id, name, {
				deleteRemote: opts.deleteRemote,
				upstream
			});
			if (!result.ok) {
				setError(result.error ?? 'Could not delete branch.');
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

	// Delete the branch currently checked out. Git refuses to delete the
	// checked-out branch, so we switch to the default branch first, then delete.
	// No-op when already on the default branch (there's nothing safe to switch
	// to). If the checkout fails (e.g. a dirty tree that would be overwritten),
	// checkoutBranch surfaces the error and we leave the branch in place.
	async deleteCurrentBranch(opts: { deleteRemote: boolean }): Promise<boolean> {
		if (!app.activeRepo) return false;
		const current = app.currentBranch;
		const base = app.activeRepo.defaultBranch ?? 'main';
		if (!current || current === base) return false;
		const switched = await actions.checkoutBranch(base);
		if (!switched) return false;
		return actions.deleteBranch(current, opts);
	},

	async createRepo(options: CreateRepoOptions): Promise<boolean> {
		try {
			const repo = await window.api.repos.createRepo(options);
			if (repo) await activateRepo(repo);
			return repo != null;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
		}
	},

	// Publish the active repo to GitHub: creates the remote, sets `origin`, and
	// pushes the current branch. Re-activates the refreshed repo so the UI picks
	// up the new remote (the Publish button gives way to push/PR actions).
	async publishRepo(options: PublishRepoOptions): Promise<boolean> {
		if (!app.activeRepo) return false;
		try {
			const repo = await window.api.repos.publish(app.activeRepo.id, options);
			await activateRepo(repo);
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
		}
	},

	async addExistingRepo(path: string): Promise<boolean> {
		try {
			const repo = await window.api.repos.addByPath(path);
			if (repo) await activateRepo(repo);
			return repo != null;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
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
		const included = app.changedFiles.filter((f) => !app.excludedFromCommit.has(f.path));
		if (included.length === 0) return false;
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		const selections = await buildCommitSelections(repoId, ctx, included);
		if (selections.length === 0) return false;
		const trimmedDescription = description?.trim() ?? '';
		const message = trimmedDescription
			? `${trimmedSummary}\n\n${trimmedDescription}`
			: trimmedSummary;
		app.push = {
			inProgress: true,
			stage: 'committing',
			intent: 'push',
			op: 'commit',
			error: null
		};
		try {
			const commit = await window.api.git.commit(repoId, message, selections);
			if (!commit.ok) throw new Error(commit.error ?? 'Commit failed.');
			app.push.stage = 'done';
			// The selection was consumed; clear partial line exclusions so stale
			// line numbers don't carry over onto the post-commit diff.
			app.stagingLineExclusions = new SvelteSet();
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
			await refreshBranchPR();
			// Drop local comments orphaned by this commit. A working-tree comment is
			// pinned to an uncommitted change; once we commit that file and nothing's
			// left in it, the comment can never re-anchor, so remove it rather than
			// strand it in the sidebar. Files with changes still remaining (a partial
			// commit) keep their comments — those may still anchor to what's left.
			await pruneCommittedComments(
				repoId,
				included.map((f) => f.path)
			);
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
			stage: 'committing',
			intent: 'push',
			op: 'commit',
			error: null
		};
		try {
			const result = await window.api.git.undoLastCommit(repoId);
			if (!result.ok) throw new Error(result.error ?? 'Undo failed.');
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
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
		const head = app.currentBranch ?? '';
		if (!head) return;
		// For a fork contributing to its parent, the PR is opened against the
		// upstream repo and the head branch must be qualified with the fork owner
		// (`owner:branch`) since it lives in a different repo. Otherwise compare
		// within the repo's own remote.
		const base = repo.defaultBranch ?? 'main';
		const url =
			repo.upstreamOwner && repo.upstreamRepo
				? `https://github.com/${repo.upstreamOwner}/${repo.upstreamRepo}/compare/${encodeURIComponent(
						base
					)}...${encodeURIComponent(`${repo.githubOwner}:${head}`)}?expand=1`
				: `https://github.com/${repo.githubOwner}/${repo.githubRepo}/compare/${encodeURIComponent(
						base
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
			stage: 'fetching',
			intent: 'pull',
			op: 'pull',
			error: null
		};
		clearConflicts();
		try {
			await window.api.git.fetchOrigin(repoId);
			app.push.stage = 'pulling';
			const pullResult = await window.api.git.pull(repoId);
			if (!pullResult.ok) {
				if (pullResult.conflicts.length > 0) {
					setConflicts(pullResult.conflicts);
					app.push.stage = 'conflicts';
					return;
				}
				// Pull blocked by uncommitted local changes git would overwrite.
				// Offer to stash them and continue instead of toasting a raw error.
				if (pullResult.blockedFiles && pullResult.blockedFiles.length > 0) {
					app.stashPrompt = { files: pullResult.blockedFiles };
					return;
				}
				throw new Error(pullResult.error ?? 'Pull failed.');
			}
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
			await refreshBranchPR();
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error);
		} finally {
			if (app.push.stage !== 'conflicts') {
				app.push.inProgress = false;
			}
		}
	},

	// Confirm "Stash Changes and Continue" from the blocked-pull prompt: park the
	// uncommitted changes in a managed stash, then re-run the pull. A "Stashed
	// Changes" row appears in the sidebar (refreshStash) for later restore.
	async confirmStashAndPull(): Promise<void> {
		if (!app.activeRepo || app.push.inProgress) return;
		const repoId = app.activeRepo.id;
		app.stashPrompt = null;
		app.push = {
			inProgress: true,
			stage: 'pulling',
			intent: 'pull',
			op: 'pull',
			error: null
		};
		clearConflicts();
		try {
			const stashed = await window.api.git.createManagedStash(repoId);
			if (!stashed.ok) throw new Error(stashed.error ?? 'Could not stash changes.');
			const pullResult = await window.api.git.pull(repoId);
			if (!pullResult.ok) {
				if (pullResult.conflicts.length > 0) {
					setConflicts(pullResult.conflicts);
					app.push.stage = 'conflicts';
					return;
				}
				throw new Error(pullResult.error ?? 'Pull failed.');
			}
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
			await refreshBranchPR();
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error);
		} finally {
			if (app.push.stage !== 'conflicts') {
				app.push.inProgress = false;
			}
		}
	},

	dismissStashPrompt(): void {
		app.stashPrompt = null;
	},

	// Enter the transient stash view: the sidebar list + diff pane swap to the
	// managed stash's contents. We point `diffContext` at the stash (not the tab
	// context) and load its files; `stashView` tracks that we're in this mode so
	// the banner shows and closing can restore the prior context.
	async openStashView(): Promise<void> {
		if (!app.stash) return;
		app.stashView = { ref: app.stash.ref };
		app.diffContext = { kind: 'stash', ref: app.stash.ref };
		app.fileSearchQuery = '';
		await refreshFiles();
	},

	// Leave the stash view, restoring the diff context the active tab drives.
	async closeStashView(): Promise<void> {
		if (!app.stashView) return;
		app.stashView = null;
		app.diffContext = contextForTab(app.contextTab);
		app.fileSearchQuery = '';
		await refreshFiles();
	},

	// Restore (pop) the managed stash back into the working tree. A clean pop
	// drops the entry and clears the view; a conflicted pop reuses the shared
	// conflict dialog under the 'stash-restore' intent so continue/abort route to
	// the dedicated stash-pop finish/abort paths.
	async restoreStash(): Promise<void> {
		if (!app.activeRepo || !app.stash || app.push.inProgress) return;
		const repoId = app.activeRepo.id;
		const ref = app.stash.ref;
		app.push = {
			inProgress: true,
			stage: 'pulling',
			intent: 'stash-restore',
			op: 'stash-restore',
			error: null
		};
		clearConflicts();
		try {
			const result = await window.api.git.restoreManagedStash(repoId, ref);
			if (!result.ok) {
				if (result.conflicts.length > 0) {
					setConflicts(result.conflicts);
					app.push.stage = 'conflicts';
					return;
				}
				throw new Error(result.error ?? 'Could not restore stashed changes.');
			}
			// Clean pop: the entry is gone, leave the stash view back to the working
			// tree where the restored changes now live.
			app.stash = null;
			app.stashView = null;
			app.diffContext = contextForTab(app.contextTab);
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error);
		} finally {
			if (app.push.stage !== 'conflicts') {
				app.push.inProgress = false;
			}
		}
	},

	// Discard (drop) the managed stash without applying it. The caller (the stash
	// view's Discard button) gates this behind the shared confirm-delete dialog,
	// since the work is unrecoverable.
	async discardStash(): Promise<void> {
		if (!app.activeRepo || !app.stash) return;
		const repoId = app.activeRepo.id;
		const ref = app.stash.ref;
		try {
			await window.api.git.discardManagedStash(repoId, ref);
			app.stash = null;
			app.stashView = null;
			app.diffContext = contextForTab(app.contextTab);
			await Promise.all([refreshFiles(), refreshStash()]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// GitHub Desktop's "Update from <default>": fetch origin, then merge the
	// repo's default branch into the current one. Reuses the pull conflict path
	// (intent "pull") so any conflicts open the shared conflict dialog and
	// continueMerge finishes the merge without pushing. No-op on the default
	// branch itself.
	async updateFromDefault(): Promise<void> {
		if (!app.activeRepo || app.push.inProgress) return;
		const repoId = app.activeRepo.id;
		const base = app.activeRepo.defaultBranch ?? 'main';
		if (app.currentBranch === base) return;
		app.push = {
			inProgress: true,
			stage: 'fetching',
			intent: 'pull',
			op: 'update',
			error: null
		};
		clearConflicts();
		try {
			const fetched = await window.api.git.fetchOrigin(repoId);
			app.push.stage = 'pulling';
			// Merge the freshly fetched remote tip when there's a remote; fall back
			// to the local default branch for repos without one.
			const ref = fetched.ok && app.pushStatus?.hasRemote ? `origin/${base}` : base;
			const result = await window.api.git.mergeIntoCurrent(repoId, ref);
			if (!result.ok) {
				if (result.conflicts.length > 0) {
					setConflicts(result.conflicts);
					app.push.stage = 'conflicts';
					return;
				}
				throw new Error(result.error ?? `Could not update from ${base}.`);
			}
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
			await refreshBranchPR();
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error);
		} finally {
			if (app.push.stage !== 'conflicts') {
				app.push.inProgress = false;
			}
		}
	},

	// GitHub Desktop's "Update from upstream/<default>": for a fork, fetch the
	// parent repo's default branch and merge it into the current one (typically
	// the fork's own default). Reuses the pull conflict path (intent "pull") so
	// conflicts open the shared dialog and continueMerge finishes the merge.
	// No-op when the repo has no known upstream.
	async updateFromUpstream(): Promise<void> {
		const repo = app.activeRepo;
		if (!repo || app.push.inProgress) return;
		if (!repo.upstreamOwner || !repo.upstreamRepo) return;
		const branch = repo.defaultBranch ?? 'main';
		app.push = {
			inProgress: true,
			stage: 'pulling',
			intent: 'pull',
			op: 'update-upstream',
			error: null
		};
		clearConflicts();
		try {
			const result = await window.api.git.updateFromUpstream(repo.id, branch);
			if (!result.ok) {
				if (result.conflicts.length > 0) {
					setConflicts(result.conflicts);
					app.push.stage = 'conflicts';
					return;
				}
				throw new Error(result.error ?? `Could not update from upstream/${branch}.`);
			}
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
			await refreshBranchPR();
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error);
		} finally {
			if (app.push.stage !== 'conflicts') {
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
			stage: 'fetching',
			intent: 'push',
			op: 'push',
			error: null
		};
		clearConflicts();
		try {
			await window.api.git.fetchOrigin(repoId);
			await refreshPushStatus();
			if (app.pushStatus?.behind && app.pushStatus.behind > 0) {
				app.push.stage = 'pulling';
				const pullResult = await window.api.git.pull(repoId);
				if (!pullResult.ok) {
					if (pullResult.conflicts.length > 0) {
						setConflicts(pullResult.conflicts);
						app.push.stage = 'conflicts';
						// Don't clear inProgress — UI shows the conflict dialog until
						// the user resolves or aborts.
						return;
					}
					throw new Error(pullResult.error ?? 'Pull failed.');
				}
			}
			app.push.stage = 'pushing';
			const pushResult = await window.api.git.push(repoId);
			if (!pushResult.ok) throw new Error(pushResult.error ?? 'Push failed.');
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
			await refreshBranchPR();
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error, 'Pushing your changes');
		} finally {
			// Only release the lock if we're not currently waiting on conflicts.
			if (app.push.stage !== 'conflicts') {
				app.push.inProgress = false;
			}
		}
	},

	// Open the "fork this repository?" dialog. `intent` is the action to resume
	// once the fork exists; for 'commit' the pending message rides along so the
	// commit runs after forking. No-op without a GitHub remote.
	promptFork(intent: 'commit' | 'push', commit?: { summary: string; description: string }): void {
		const repo = app.activeRepo;
		if (!repo || !repo.githubOwner || !repo.githubRepo) return;
		app.forkPrompt = { owner: repo.githubOwner, repo: repo.githubRepo, intent, commit };
	},

	// Dismiss the fork dialog without forking (Cancel = abort the action). Ignored
	// mid-fork so the dialog can't be torn out from under an in-flight request.
	cancelFork(): void {
		if (app.push.inProgress && app.push.stage === 'forking') return;
		app.forkPrompt = null;
	},

	// Create the fork, repoint the local remotes at it (origin → fork; upstream →
	// parent when contributing to it), then resume the action that triggered the
	// prompt. Pushes land on the fork from here on. `contributeToParent` mirrors
	// GitHub Desktop's fork-use choice — it decides whether PRs/sync target the
	// parent or the fork itself.
	async confirmFork(contributeToParent: boolean): Promise<void> {
		const prompt = app.forkPrompt;
		if (!prompt || !app.activeRepo || app.push.inProgress) return;
		const repoId = app.activeRepo.id;
		app.push = { inProgress: true, stage: 'forking', intent: 'push', op: 'push', error: null };
		try {
			const fork = await window.api.github.createFork(repoId);
			const updated = await window.api.git.convertToFork(
				repoId,
				fork.owner,
				fork.repo,
				contributeToParent
			);
			if (app.activeRepo?.id === updated.id) {
				app.activeRepo = updated;
				const idx = app.repos.findIndex((r) => r.id === updated.id);
				if (idx !== -1) app.repos[idx] = updated;
			}
			// Origin is now the user's fork — they can push. Update the cached answer
			// so the banner doesn't reappear, and let the upstream/PR-source resolve
			// against the new parent on the next PR load.
			repoPushAccessChecked.set(repoId, true);
			app.repoPushAccess = true;
			upstreamChecked.delete(repoId);
			app.forkPrompt = null;
			// Hand off to commit()/push(), which run their own app.push lifecycle.
			app.push.inProgress = false;
			app.push.stage = 'idle';
			if (prompt.intent === 'commit' && prompt.commit) {
				const ok = await actions.commit(prompt.commit.summary, prompt.commit.description);
				if (ok) await actions.push();
			} else {
				await actions.push();
			}
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error);
			app.forkPrompt = null;
			app.push.inProgress = false;
			app.push.stage = 'idle';
		}
	},

	// Re-scan the conflict files for leftover markers (the conflict dialog polls
	// this while open). Files whose markers are gone get staged automatically, so
	// editing a file to resolution in your editor is all it takes — no explicit
	// "mark resolved" step. Updates the unresolved subset that drives each row's
	// alert/check icon and gates "Continue merge".
	async recheckConflicts(): Promise<void> {
		if (!app.activeRepo || app.conflictFiles.length === 0) return;
		try {
			// Pass a plain array — a $state proxy can't be structured-cloned over IPC.
			app.conflictUnresolved = await window.api.git.recheckConflicts(app.activeRepo.id, [
				...app.conflictFiles
			]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	},

	// Called from the conflict dialog after the user resolves every file.
	// Finishes the merge commit, then continues the push that triggered it.
	async continueMerge(): Promise<void> {
		if (!app.activeRepo) return;
		const repoId = app.activeRepo.id;
		// A conflicted stash-restore pop has no MERGE_HEAD and must not create a
		// commit — finishStashPop just verifies resolution and drops the marker
		// stash. The restored changes stay in the working tree; never push.
		if (app.push.intent === 'stash-restore') {
			try {
				// Prefer the ref pinned on push state: a bring-to-another-branch pop
				// leaves us on the target, where refreshStash nulls app.stash.
				const ref = app.push.stashRef ?? app.stash?.ref ?? app.stashView?.ref;
				if (!ref) throw new Error('No stash to finish restoring.');
				const finished = await window.api.git.finishStashPop(repoId, ref);
				if (!finished.ok) {
					if (finished.conflicts.length > 0) {
						setConflicts(finished.conflicts);
						return;
					}
					throw new Error(finished.error ?? 'Could not finish restoring stashed changes.');
				}
				clearConflicts();
				app.stash = null;
				app.stashView = null;
				app.push.stashRef = null;
				app.diffContext = contextForTab(app.contextTab);
				app.push.stage = 'done';
				bumpDiffReload();
				await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
			} catch (err) {
				app.push.error = err instanceof Error ? err.message : String(err);
				setError(app.push.error);
			} finally {
				app.push.inProgress = false;
			}
			return;
		}
		try {
			const merge = await window.api.git.continueMerge(repoId);
			if (!merge.ok) {
				if (merge.conflicts.length > 0) {
					setConflicts(merge.conflicts);
					return;
				}
				throw new Error(merge.error ?? 'Could not continue merge.');
			}
			clearConflicts();
			// For a pull-only flow, the merge commit is all we needed — skip push.
			if (app.push.intent === 'pull') {
				app.push.stage = 'done';
				bumpDiffReload();
				await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
				await refreshBranchPR();
				return;
			}
			// Resume the push pipeline.
			app.push.stage = 'pushing';
			const pushResult = await window.api.git.push(repoId);
			if (!pushResult.ok) throw new Error(pushResult.error ?? 'Push failed.');
			app.push.stage = 'done';
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
		} catch (err) {
			app.push.error = err instanceof Error ? err.message : String(err);
			setError(app.push.error);
		} finally {
			app.push.inProgress = false;
		}
	},

	async abortMerge(): Promise<void> {
		if (!app.activeRepo) return;
		// Aborting a conflicted stash-restore discards the half-applied work but
		// leaves the managed stash intact (abortStashPop), so the user can try
		// again later. `git merge --abort` would be invalid — there's no merge.
		const isStashRestore = app.push.intent === 'stash-restore';
		try {
			if (isStashRestore) {
				await window.api.git.abortStashPop(app.activeRepo.id);
			} else {
				await window.api.git.abortMerge(app.activeRepo.id);
			}
			clearConflicts();
			app.push = {
				inProgress: false,
				stage: 'idle',
				intent: 'push',
				op: 'push',
				error: null
			};
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
			// The stash entry is preserved on abort — keep the row by re-resolving it.
			if (isStashRestore) await refreshStash();
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
			setError('No external editor is configured. Install the cursor or code CLI.');
			return;
		}
		const path = target ?? app.activeRepo.path;
		const resolved = target && !target.startsWith('/') ? `${app.activeRepo.path}/${target}` : path;
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
			app.platform === 'win32'
				? 'Reveal in Explorer'
				: app.platform === 'linux'
					? 'Reveal in File Manager'
					: 'Reveal in Finder';
		// Bulk actions apply when the right-clicked file is part of a multi-file
		// selection. The caller (onRowContextMenu) guarantees `file` is in the set,
		// so the count alone decides single vs. bulk.
		const selectedPaths = [...app.selectedFiles];
		const isBulk = selectedPaths.length > 1 && app.selectedFiles.has(file.path);
		const action = await window.api.menu.showFileContextMenu({
			filePath: file.path,
			canDiscard: app.diffContext.kind === 'workingTree',
			canInclude: app.contextTab === 'unstaged',
			selectedCount: isBulk ? selectedPaths.length : 1,
			editorLabel: editor ? EDITOR_LABELS[editor] : null,
			revealLabel
		});
		switch (action) {
			case 'discard':
				await actions.discardFile(file.path, file.oldPath);
				break;
			case 'discardSelected': {
				// Snapshot the targets before discarding — discardFile mutates
				// changedFiles as it goes.
				const targets = app.changedFiles.filter((f) => app.selectedFiles.has(f.path));
				for (const f of targets) {
					await actions.discardFile(f.path, f.oldPath);
				}
				actions.clearSelectedFiles();
				break;
			}
			case 'includeSelected':
				actions.setFilesIncludedForCommit(selectedPaths, true);
				break;
			case 'excludeSelected':
				actions.setFilesIncludedForCommit(selectedPaths, false);
				break;
			case 'markSelectedSeen':
				for (const p of selectedPaths) await actions.toggleSeen(p, true);
				break;
			case 'markSelectedUnseen':
				for (const p of selectedPaths) await actions.toggleSeen(p, false);
				break;
			case 'copyPath':
				await actions.copyToClipboard(actions.resolveRepoPath(file.path) ?? file.path);
				break;
			case 'copyRelativePath':
				await actions.copyToClipboard(file.path);
				break;
			case 'reveal':
				await actions.revealFile(file.path);
				break;
			case 'openInEditor':
				await actions.openInEditor(file.path);
				break;
			case 'openDefault':
				await actions.openFileWithDefault(file.path);
				break;
		}
	},

	// Discard a hunk (an outer gutter button's section) or a single line (an inner
	// button) from the staging gutter's native context menu. The caller passes the
	// exact line keys to discard; we confirm via the menu, then build a
	// working-tree-based patch for those lines and apply it. Only offered in the
	// unstaged working-tree tab where line staging lives (see
	// DiffFileSection.onStagingContextMenu), so the diff is always HEAD->worktree.
	async discardDiffLines(filePath: string, keys: string[], scope: 'line' | 'lines'): Promise<void> {
		if (!app.activeRepo || keys.length === 0) return;
		const repoId = app.activeRepo.id;
		const ctx = $state.snapshot(app.diffContext) as DiffContext;

		const action = await window.api.menu.showDiffLineContextMenu({ scope });
		if (!action) return;

		// Parse the file's current diff so the reduced patch is built against live
		// content (re-fetch if not cached).
		let diff = getCachedDiff(repoId, ctx, filePath);
		if (!diff) {
			diff = await window.api.git.getDiff(repoId, filePath, ctx).catch(() => undefined);
		}
		const parsed = diff?.patch ? parseFilePatch(diff.patch) : null;
		if (!parsed) return;

		const { adds, dels } = lineKeySides(filePath, keys);
		const patch = buildDiscardPatch(parsed, adds, dels);
		// `null` means none of the keys match a current change (e.g. the file moved
		// underneath) — nothing to discard.
		if (!patch) return;

		try {
			await window.api.git.discardLines(repoId, filePath, patch);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return;
		}

		// The discarded changes no longer exist, so any staging exclusions that
		// referenced them are stale — drop them.
		for (const k of keys) app.stagingLineExclusions.delete(k);

		// The file's content changed in place: force the open diff to re-fetch and
		// refresh the list (the file drops out if that was its last change).
		bumpDiffReload();
		await Promise.all([refreshFiles(), refreshPushStatus()]);
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
		// SvelteSet — delete in place (a no-op when the path isn't present).
		app.seenFiles.delete(filePath);
		app.collapsedFiles.delete(filePath);

		// Discard only happens in the working-tree context, where the file list IS
		// the unstaged set — keep the tab badge in step.
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		if (ctx.kind === 'workingTree') {
			app.unstagedFileCount = remaining.length;
			setRepoDirty(repoId, remaining.length > 0);
		}

		// Drop the stale cached diff and prune the per-context files cache so a tab
		// switch (which hydrates from cache) can't resurrect the discarded file.
		diffCache.delete(diffCacheKeyFor(repoId, ctx, filePath));
		const cached = filesCache.get(filesCacheKey(repoId, ctx));
		if (cached) {
			cached.changedFiles = cached.changedFiles.filter((f) => f.path !== filePath);
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

	// Discard every uncommitted working-tree change (GitHub Desktop's "Discard
	// all changes"). Always operates on the working tree regardless of the active
	// tab, so a branch/PR diff that happens to be showing isn't mistaken for the
	// discard target. Tracked files revert to HEAD; untracked files go to the OS
	// trash. The caller confirms first — this just executes. Refreshes once at
	// the end rather than surgically, since the whole list is going away.
	async discardAllChanges(): Promise<boolean> {
		if (!app.activeRepo) return false;
		const repoId = app.activeRepo.id;
		try {
			const targets = await window.api.git.listChangedFiles(repoId, {
				kind: 'workingTree'
			});
			for (const f of targets) {
				await window.api.git.discardChanges(repoId, f.path, f.oldPath);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return false;
		} finally {
			await Promise.all([refreshFiles(), refreshPushStatus()]);
		}
		return true;
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

	// Open the repository's folder in the OS file manager.
	async openRepoInFileManager(): Promise<void> {
		if (!app.activeRepo) return;
		const result = await window.api.shell.openPath(app.activeRepo.path);
		if (!result.ok && result.error) setError(result.error);
	},

	// Open the repository's page on GitHub in the default browser. For a fork
	// contributing to its parent, opens the parent (matching GitHub Desktop). No-op
	// when there's no GitHub remote.
	async openRepoOnGithub(): Promise<void> {
		const host = githubHostRepo();
		if (!host) return;
		await window.api.shell.openExternal(`https://github.com/${host.owner}/${host.repo}`);
	},

	// Open GitHub's "new issue" page in the browser. Targets the upstream parent
	// for a fork contributing to it (matching GitHub Desktop). No-op without a
	// GitHub remote.
	async createIssueOnGithub(): Promise<void> {
		const host = githubHostRepo();
		if (!host) return;
		await window.api.shell.openExternal(`https://github.com/${host.owner}/${host.repo}/issues/new`);
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
			setError('No terminal is configured.');
			return;
		}
		const path = target ?? app.activeRepo.path;
		const resolved = target && !target.startsWith('/') ? `${app.activeRepo.path}/${target}` : path;
		const result = await window.api.terminal.open(terminal, resolved);
		if (!result.ok && result.error) setError(result.error);
	},

	async setViewMode(mode: ViewMode): Promise<void> {
		app.viewMode = mode;
		app.prefs = await window.api.state.setPrefs({ viewMode: mode });
	},

	async setDiffLayout(layout: DiffLayout): Promise<void> {
		app.diffLayout = layout;
		app.prefs = await window.api.state.setPrefs({ diffLayout: layout });
	},

	// Set the file list layout for the active sidebar tab. Unstaged and branch
	// each persist their own layout; the 'sessions' tab has no file list so it
	// falls through to the unstaged setting harmlessly.
	async setFileListLayout(layout: FileListLayout): Promise<void> {
		if (app.contextTab === 'branch') {
			app.branchFileListLayout = layout;
			app.prefs = await window.api.state.setPrefs({
				branchFileListLayout: layout
			});
		} else {
			app.unstagedFileListLayout = layout;
			app.prefs = await window.api.state.setPrefs({
				unstagedFileListLayout: layout
			});
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
		const next = uniqueStrings(patterns.map((p) => p.trim()).filter(Boolean));
		app.hiddenDiffPatterns = next;
		app.prefs = await window.api.state.setPrefs({ hiddenDiffPatterns: next });
	},

	async setCustomFileIcons(icons: CustomFileIcon[]): Promise<void> {
		// Normalize: trim both fields, drop rows missing a pattern or source.
		const next = icons
			.map((i) => ({ pattern: i.pattern.trim(), source: i.source.trim() }))
			.filter((i) => i.pattern && i.source);
		app.customFileIcons = next;
		app.prefs = await window.api.state.setPrefs({ customFileIcons: next });
	},

	async setAnimations(mode: AnimationMode): Promise<void> {
		app.animations = mode;
		app.prefs = await window.api.state.setPrefs({ animations: mode });
	},

	async setPrMergedBehavior(value: PrMergedBehavior): Promise<void> {
		app.prMergedBehavior = value;
		app.prefs = await window.api.state.setPrefs({ prMergedBehavior: value });
	},

	async setAutoRemoveMergedBranch(value: boolean): Promise<void> {
		app.autoRemoveMergedBranch = value;
		app.prefs = await window.api.state.setPrefs({ autoRemoveMergedBranch: value });
	},

	async setUnmarkSeenOnChange(value: boolean): Promise<void> {
		app.unmarkSeenOnChange = value;
		app.prefs = await window.api.state.setPrefs({ unmarkSeenOnChange: value });
	},

	async setRecentRepoCount(count: number): Promise<void> {
		// 0 is meaningful (hides the Recent section); invalid input keeps the
		// current value rather than silently hiding it.
		const next = Number.isFinite(count) && count >= 0 ? Math.floor(count) : app.recentRepoCount;
		app.recentRepoCount = next;
		app.prefs = await window.api.state.setPrefs({ recentRepoCount: next });
	},

	// Persist the initial window size. Clamped to the window minimums (and falling
	// back to the defaults for empty/invalid input) so a stored value can never
	// produce a smaller-than-allowed window. Takes effect on the next launch.
	async setWindowSize(width: number, height: number): Promise<void> {
		const w = clampWindowDimension(width, WINDOW_BOUNDS.minWidth, WINDOW_BOUNDS.defaultWidth);
		const h = clampWindowDimension(height, WINDOW_BOUNDS.minHeight, WINDOW_BOUNDS.defaultHeight);
		app.windowWidth = w;
		app.windowHeight = h;
		app.prefs = await window.api.state.setPrefs({ windowWidth: w, windowHeight: h });
	},

	async setStartMaximized(value: boolean): Promise<void> {
		app.startMaximized = value;
		app.prefs = await window.api.state.setPrefs({ startMaximized: value });
	},

	// Resolve the "switch back to the default branch?" dialog. `action` is the
	// button the user chose; `always` persists that choice as the default so
	// future merges skip the prompt (either auto-switching or doing nothing).
	async resolveMergedSwitchPrompt(opts: {
		action: 'switch' | 'nothing';
		always: boolean;
	}): Promise<void> {
		const prompt = app.mergedSwitchPrompt;
		if (!prompt) return;
		app.mergedSwitchPrompt = null;
		if (opts.always) await actions.setPrMergedBehavior(opts.action);
		if (opts.action === 'switch') {
			await performSwitchBackAfterMerge(prompt.branch, prompt.defaultBranch);
		}
	},

	// Dismiss without choosing (escape / outside click / close button) — leaves
	// the working tree as-is for now and asks again on the next merge.
	dismissMergedSwitchPrompt(): void {
		app.mergedSwitchPrompt = null;
	},

	// Confirm the "remove this branch locally?" dialog. `always` persists the
	// choice so future merged branches are removed automatically.
	async confirmRemoveMergedBranch(opts: { always: boolean }): Promise<void> {
		const prompt = app.mergedRemovePrompt;
		if (!prompt) return;
		app.mergedRemovePrompt = null;
		if (opts.always) await actions.setAutoRemoveMergedBranch(true);
		await actions.deleteBranch(prompt.branch, { deleteRemote: false });
	},

	dismissMergedRemovePrompt(): void {
		app.mergedRemovePrompt = null;
	},

	async setHotkeys(hotkeys: Hotkeys): Promise<void> {
		app.hotkeys = hotkeys;
		app.prefs = await window.api.state.setPrefs({ hotkeys });
	},

	async setTheme(theme: 'light' | 'dark'): Promise<void> {
		app.theme = theme;
		applyTheme(theme);
		app.prefs = await window.api.state.setPrefs({ theme });
	},

	async setDiffTheme(diffTheme: string): Promise<void> {
		app.diffTheme = diffTheme;
		applyDiffTheme();
		app.prefs = await window.api.state.setPrefs({ diffTheme });
	},

	async setAccent(accent: Accent): Promise<void> {
		app.accent = accent;
		applyAccent(accent);
		app.prefs = await window.api.state.setPrefs({ accent });
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

	openSettingsDialog(tab?: SettingsTab, scrollTo?: SettingsScrollTarget): void {
		if (tab) app.settingsDialogTab = tab;
		if (scrollTo) {
			app.settingsDialogScrollTo = scrollTo;
			app.settingsDialogScrollNonce++;
		}
		app.settingsDialogOpen = true;
	},
	closeSettingsDialog(): void {
		app.settingsDialogOpen = false;
	},

	openFeedbackDialog(prefill?: FeedbackDraft): void {
		app.feedbackPrefill = prefill ?? null;
		app.feedbackDialogOpen = true;
	},
	closeFeedbackDialog(): void {
		app.feedbackDialogOpen = false;
		app.feedbackPrefill = null;
	},
	// One-click report: turn an error toast into a pre-filled feedback report and
	// open the dialog so the user can add detail and send. The captured context
	// (action/tab/repo/branch/location) is woven into the body so an agent
	// triaging the issue knows what the user was doing. Dismisses the toast since
	// it's now being acted on.
	reportErrorToast(toast: ErrorToast): void {
		app.feedbackPrefill = feedbackDraftFromError(toast);
		app.feedbackDialogOpen = true;
		dismissError(toast.id);
	},
	// File the feedback as a GitHub issue on the project's own repo. Returns the
	// created issue so the dialog can link to it; throws on failure so the dialog
	// can show the error inline without losing the user's typed text.
	async submitFeedback(input: FeedbackInput): Promise<FeedbackResult> {
		return window.api.feedback.submit(input);
	},

	openRepoSettingsDialog(): void {
		if (!app.activeRepo) return;
		app.repoSettingsDialogOpen = true;
	},
	closeRepoSettingsDialog(): void {
		app.repoSettingsDialogOpen = false;
	},

	// Change an existing fork's contribution target (Fork Behavior settings).
	// Wires up or tears down the upstream parent, then refreshes the repo so the
	// PR list / "Create PR" / "View on GitHub" follow the new target.
	async setForkBehavior(contributeToParent: boolean): Promise<void> {
		const repo = app.activeRepo;
		if (!repo) return;
		try {
			const updated = await window.api.git.setForkContribution(repo.id, contributeToParent);
			if (app.activeRepo?.id === updated.id) {
				app.activeRepo = updated;
				const idx = app.repos.findIndex((r) => r.id === updated.id);
				if (idx !== -1) app.repos[idx] = updated;
			}
			// The upstream changed — let the PR source resolve against it again.
			upstreamChecked.delete(repo.id);
			prsSourceByRepo.delete(repo.id);
			if (app.activeRepo?.id === repo.id) {
				app.prsSource = defaultPRSource(app.activeRepo);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
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
	// The sidebar owns its search input, so the global hotkey routes through a
	// nonce the FileList watches rather than reaching across components.
	focusSidebarSearch(): void {
		app.focusSidebarSearchNonce++;
	},

	openGithubSignIn(): void {
		void startGithubSignInFlow();
	},
	closeGithubSignIn(): void {
		// Abort any in-flight flow (the run token bump stops its poll loop) and tell
		// the main process to drop the pending device flow, then clear the dialog.
		githubSignInRunToken++;
		void window.api.github.cancelDeviceFlow();
		const s = app.githubSignIn;
		s.open = false;
		s.polling = false;
		s.userCode = null;
		s.verificationUri = null;
		s.error = null;
	},

	tickNow(): void {
		app.nowTick++;
	},

	async refreshPrChecks(): Promise<void> {
		await refreshPrChecks();
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
		// Push-access answers were computed as the previous account — every repo
		// following the default may now resolve differently.
		repoPushAccessChecked.clear();
		prPushAccess.clear();
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
		// The cached push-access answers were the previous account's — without
		// dropping them, switching to an account that *does* have write access
		// leaves a stale "fork this repo" banner for the rest of the session.
		repoPushAccessChecked.delete(repoId);
		prPushAccess.clear();
		app.repoPushAccess = null;
		app.prs = [];
		if (updated.githubOwner && updated.githubRepo) {
			void actions.loadPRs();
			// The new account may see a different (or newly visible) PR for this
			// branch, so re-resolve it rather than leaving the stale result.
			void refreshBranchPR();
		}
	},

	// Auth-failure state pushed live from the main process: a token started
	// failing (revoked / SAML session lapsed) or recovered (re-sign-in, SSO
	// re-authorized, or simply the next successful request). On recovery,
	// previously unknowable answers become resolvable — drop the push-access
	// caches and re-resolve the branch/PR state.
	onGithubAuthChanged(errors: GithubAuthError[]): void {
		const hadErrors = app.githubAuthErrors.length > 0;
		app.githubAuthErrors = errors;
		if (hadErrors && errors.length === 0) {
			repoPushAccessChecked.clear();
			prPushAccess.clear();
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
		if (app.activeGithubAccount && app.activeRepo?.githubOwner && app.activeRepo.githubRepo) {
			void actions.loadPRs();
		}
	}
};
