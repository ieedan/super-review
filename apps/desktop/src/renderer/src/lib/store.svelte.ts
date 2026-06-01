import type {
	Accent,
	AppPlatform,
	BranchInfo,
	ChangedFile,
	CommitFileSelection,
	ContextTab,
	CreateRepoOptions,
	DiffContext,
	DiffData,
	DiffLayout,
	EditorKind,
	FileListLayout,
	GithubAccount,
	LastCommit,
	PRChecksSummary,
	PRReviewComment,
	PRSource,
	PRSummary,
	PrMergedBehavior,
	PushStatus,
	RepoInfo,
	Session,
	SessionSummary,
	TerminalKind,
	UserPrefs,
	ViewMode
} from '@shared/types';
import { diffContextKey } from '@shared/diff-context';
import {
	buildFilteredPatch,
	parseFilePatch,
	stagingLineKey,
	type DiffSide
} from '@shared/diff-staging';
import { DEFAULT_HIDDEN_DIFF_PATTERNS } from '@shared/diff-defer';
import { DEFAULT_HOTKEYS, type Hotkeys } from '@shared/hotkeys';
import { comparePathsVSCodeStyle } from '$lib/utils';
import { repoFrecency } from '$lib/repo-frecency.svelte';
import { SvelteSet } from 'svelte/reactivity';
import {
	upstreamChecked,
	prsSourceByRepo,
	filesCache,
	diffCache,
	prPushAccess
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
	// Whether the document-session skill is installed in the active repo. null
	// while unknown (no active repo, or the check hasn't returned yet); false
	// drives the "Install skill" prompts in the header and sessions empty state.
	skillInstalled: boolean | null;
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
	animationsEnabled: boolean;
	prMergedBehavior: PrMergedBehavior;
	autoRemoveMergedBranch: boolean;
	hotkeys: Hotkeys;
	theme: 'light' | 'dark';
	accent: Accent;
	codeFont: string;
	uiFont: string;
	// Font families installed on the user's machine, queried lazily on launch.
	// Empty when the Local Font Access API is unavailable or denied.
	systemFonts: string[];
	prefs: UserPrefs | null;
	githubAccounts: GithubAccount[];
	activeGithubAccount: GithubAccount | null;
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
	// Set when a checked-out branch's PR is observed transitioning unmerged →
	// merged, driving the "switch back to the default branch?" dialog. Cleared
	// when the user confirms or dismisses. Never set by merely navigating to an
	// already-merged PR — only by a live transition we observed.
	mergedSwitchPrompt: { branch: string; defaultBranch: string; prNumber: number } | null;
	// Set after switching off a merged branch (via dialog or auto-switch) to drive
	// the "remove this branch locally?" dialog. Holds the branch to delete.
	mergedRemovePrompt: { branch: string } | null;
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
		stage: 'idle' | 'fetching' | 'committing' | 'pulling' | 'pushing' | 'conflicts' | 'done';
		intent: 'push' | 'pull';
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
	loading: {
		files: boolean;
		branches: boolean;
		prs: boolean;
		repos: boolean;
	};
	error: string | null;
}

export function composerKey(filePath: string, side: 'LEFT' | 'RIGHT', line: number): string {
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
	if (app.diffContext.kind === 'pr') return app.diffContext.prNumber;
	if (app.branchPR) return app.branchPR.number;
	return null;
}

// The PR the comment/checks surface currently targets (the one being reviewed,
// or the current branch's PR).
function commentablePR(): PRSummary | null {
	if (app.diffContext.kind === 'pr') return app.activePR;
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
	skillInstalled: null,
	changedFiles: [],
	fileSearchQuery: '',
	unstagedFileCount: 0,
	dirtyRepoIds: new SvelteSet(),
	selectedFile: null,
	selectedFiles: new SvelteSet(),
	seenFiles: new SvelteSet(),
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
	animationsEnabled: false,
	prMergedBehavior: 'prompt',
	autoRemoveMergedBranch: false,
	hotkeys: DEFAULT_HOTKEYS,
	theme: 'dark',
	accent: 'super',
	codeFont: 'system',
	uiFont: 'system',
	systemFonts: [],
	prefs: null,
	githubAccounts: [],
	activeGithubAccount: null,
	sidebarCollapsed: false,
	collapsedFolders: new SvelteSet(),
	scrollRequest: null,
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
	commandMenuOpen: false,
	githubSignInOpen: false,
	pushStatus: null,
	lastCommit: null,
	branchPR: null,
	branchPRChecks: null,
	branchPRPushAccess: null,
	mergedSwitchPrompt: null,
	mergedRemovePrompt: null,
	activePR: null,
	prComments: {},
	loadingComments: false,
	pendingComposers: {},
	addRepoDialogOpen: false,
	createBranchDialogOpen: false,
	push: { inProgress: false, stage: 'idle', intent: 'push', error: null },
	conflictFiles: [],
	conflictUnresolved: [],
	diffReloadToken: 0,
	loading: { files: false, branches: false, prs: false, repos: false },
	error: null
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

export function setError(msg: string | null): void {
	app.error = msg;
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

function applyTheme(theme: 'light' | 'dark'): void {
	const root = document.documentElement;
	root.classList.toggle('dark', theme === 'dark');
	root.classList.toggle('light', theme === 'light');
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

async function refreshGithubAccounts(): Promise<void> {
	const [accounts, active] = await Promise.all([
		window.api.github.listAccounts(),
		window.api.github.getActiveAccount()
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

// Make `repo` the active repo and load everything its view needs. Shared by the
// open/create flows so they land the user in an identical, fully-refreshed state.
async function activateRepo(repo: RepoInfo): Promise<void> {
	app.activeRepo = repo;
	repoFrecency.use(repo.id);
	applyContextTab('unstaged');
	app.diffContext = { kind: 'workingTree' };
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
	await Promise.all([refreshRepos(), refreshBranches(), refreshFiles(), refreshPushStatus()]);
	await refreshBranchPR();
	void refreshSkillInstalled();
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
	// Drop any status for a PR we're no longer showing, then refresh.
	if (app.branchPRChecks && app.branchPRChecks.number !== app.branchPR?.number) {
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
			...prHostArgs(pr)
		);
		// The PR may have changed while the request was in flight; only apply the
		// result if it still matches what we're showing.
		if (app.branchPR?.number === pr.number) {
			app.branchPRChecks = { number: pr.number, summary };
		}
	} catch (err) {
		console.error('[branchPR] checks lookup threw:', err);
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
	app.fileSearchQuery = '';
	void window.api.state.setPrefs({ contextTab: tab }).then((prefs) => {
		app.prefs = prefs;
	});
}

// Resolve which DiffContext the current tab should drive.
function contextForTab(tab: ContextTab): DiffContext {
	if (tab === 'branch') {
		const base = app.activeRepo?.defaultBranch ?? 'main';
		const head = app.currentBranch ?? 'HEAD';
		return { kind: 'branch', base, head };
	}
	if (tab === 'sessions' && app.activeSessionId) {
		return { kind: 'session', sessionId: app.activeSessionId };
	}
	// Sessions without an open session show the list, not a diff — fall back to
	// the working tree context (unused while the list is shown).
	return { kind: 'workingTree' };
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
	try {
		const count = await window.api.sessions.count(repoId);
		if (app.activeRepo?.id === repoId) app.sessionCount = count;
	} catch {
		// keep previous count
	}
}

// Check whether the document-session skill is installed in the active repo and
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

async function refreshFiles(): Promise<void> {
	if (!app.activeRepo) {
		app.changedFiles = [];
		app.unstagedFileCount = 0;
		return;
	}
	// The Sessions tab with no session open shows the sessions list, not a file
	// list — don't let a background refresh (focus/poll) repopulate the sidebar
	// with working-tree files behind it. Keep the Unstaged badge fresh, though.
	if (app.contextTab === 'sessions' && !app.activeSessionId) {
		app.changedFiles = [];
		void refreshUnstagedCount();
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
			window.api.state.getCollapsedFiles(repoId, diffContextKey(ctx))
		]);
		// Sort by path so the diff view and the sidebar tree agree on order —
		// otherwise the "first file in the tree" can land mid-list in the diff
		// view, and scrolling past it jumps to whatever git happened to list
		// before/after instead of feeling like you're at the boundary.
		const files = [...raw].sort((a, b) => comparePathsVSCodeStyle(a.path, b.path));
		// Bail if the user switched tabs / repos while we were fetching.
		if (!app.activeRepo || app.activeRepo.id !== repoId) return;
		const currentCtx = $state.snapshot(app.diffContext) as DiffContext;
		if (filesCacheKey(repoId, currentCtx) !== cacheKey) return;

		const seenSet = new SvelteSet(seenList);
		const collapsedSet = new SvelteSet(collapsedList);

		const stillSelected = app.selectedFile && files.some((f) => f.path === app.selectedFile);
		const firstUnseen = files.find((f) => !seenSet.has(f.path));
		const nextSelected = stillSelected
			? app.selectedFile
			: (firstUnseen?.path ?? files[0]?.path ?? null);

		app.changedFiles = files;
		app.seenFiles = seenSet;
		app.collapsedFiles = collapsedSet;
		app.selectedFile = nextSelected;

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

		filesCache.set(cacheKey, {
			changedFiles: files,
			seenFiles: new Set(seenSet),
			collapsedFiles: new Set(collapsedSet),
			selectedFile: nextSelected
		});

		// Keep the Unstaged tab badge in sync. When the active context already is
		// the working tree, the fetched list IS the unstaged count; otherwise we
		// need a separate fetch since the active tab isn't tracking it.
		if (ctx.kind === 'workingTree') {
			app.unstagedFileCount = files.length;
			setRepoDirty(repoId, files.length > 0);
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

export const actions = {
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
		app.animationsEnabled = app.prefs.animationsEnabled ?? false;
		app.prMergedBehavior = app.prefs.prMergedBehavior ?? 'prompt';
		app.autoRemoveMergedBranch = app.prefs.autoRemoveMergedBranch ?? false;
		app.hotkeys = { ...DEFAULT_HOTKEYS, ...app.prefs.hotkeys };
		app.theme = app.prefs.theme;
		applyTheme(app.theme);
		app.accent = app.prefs.accent ?? 'super';
		applyAccent(app.accent);
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
			if (savedTab === 'branch') {
				await refreshBranches();
				app.contextTab = 'branch';
				app.diffContext = contextForTab('branch');
				await Promise.all([refreshFiles(), refreshPushStatus()]);
			} else if (savedTab === 'sessions') {
				app.contextTab = 'sessions';
				// The Sessions tab shows the documented-sessions list (in the sidebar),
				// not a working-tree file list — load the sessions. Still fetch the
				// Unstaged badge count so it's accurate on launch.
				await Promise.all([
					refreshBranches(),
					refreshPushStatus(),
					refreshUnstagedCount(),
					actions.loadSessions()
				]);
			} else {
				await Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()]);
			}
			await refreshBranchPR();
			void refreshSkillInstalled();
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
			await refreshRepos();
			app.activeRepo = await window.api.repos.getActive();
			if (app.activeRepo) {
				repoFrecency.use(app.activeRepo.id);
				await Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()]);
				await refreshBranchPR();
				void refreshSkillInstalled();
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
			await refreshRepos();
			app.activeRepo = await window.api.repos.getActive();
			if (app.activeRepo) {
				repoFrecency.use(app.activeRepo.id);
				await Promise.all([refreshBranches(), refreshFiles(), refreshPushStatus()]);
				await refreshBranchPR();
				void refreshSkillInstalled();
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
			applyContextTab('unstaged');
			app.diffContext = { kind: 'workingTree' };
			// Clear the outgoing repo's file list / diff so it doesn't linger while
			// the new repo loads.
			app.changedFiles = [];
			app.selectedFile = null;
			app.selectedFiles = new SvelteSet();
			app.activeSessionId = null;
			app.activeSessionDetail = null;
			app.sessions = [];
			app.sessionCount = 0;
			app.skillInstalled = null;
			app.excludedFromCommit = new SvelteSet();
			app.stagingLineExclusions = new SvelteSet();
			app.prs = [];
			app.prsHasMore = false;
			prsPage = 0;
			app.prsSource = prsSourceByRepo.get(repo.id) ?? defaultPRSource(repo);
			app.branchPR = null;
			await Promise.all([refreshRepos(), refreshBranches(), refreshFiles(), refreshPushStatus()]);
			await refreshBranchPR();
			void refreshSkillInstalled();
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
		app.diffContext = contextForTab(tab);
		if (app.activeRepo) {
			const cached = filesCache.get(
				filesCacheKey(app.activeRepo.id, $state.snapshot(app.diffContext) as DiffContext)
			);
			if (cached) {
				app.changedFiles = cached.changedFiles;
				app.seenFiles = new SvelteSet(cached.seenFiles);
				app.collapsedFiles = new SvelteSet(cached.collapsedFiles);
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
		const sessions = await window.api.sessions.list(repoId);
		if (!app.activeRepo || app.activeRepo.id !== repoId) return;
		app.sessions = sessions;
		// Keep the badge in step with the freshly loaded list.
		app.sessionCount = sessions.length;
		if (app.activeSessionId) {
			if (sessions.some((s) => s.id === app.activeSessionId)) {
				await actions.openSession(app.activeSessionId);
			} else {
				actions.closeSession();
			}
		}
	},

	// Open a session's frozen diff: drives the file list + diff view through the
	// existing context machinery via a `session` DiffContext. Also loads the full
	// session detail (incl. tour steps) so the tour can render.
	async openSession(id: string): Promise<void> {
		app.activeSessionId = id;
		app.diffContext = { kind: 'session', sessionId: id };
		app.activePR = null;
		app.prComments = {};
		app.pendingComposers = {};
		app.activeSessionDetail = null;
		// Land on the tour; the file search query carries no meaning into a fresh
		// session, so clear it (the Changes tab re-enables search).
		app.sessionView = 'tour';
		app.fileSearchQuery = '';
		if (app.activeRepo) {
			const repoId = app.activeRepo.id;
			void window.api.sessions.get(repoId, id).then((detail) => {
				// Guard against a slow fetch landing after the user moved on.
				if (app.activeSessionId === id && app.activeRepo?.id === repoId) {
					app.activeSessionDetail = detail;
				}
			});
		}
		await refreshFiles();
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

	// Re-check whether the document-session skill is installed in the active repo
	// (e.g. after the repo's `.claude` dir may have changed on disk).
	async refreshSkillInstalled(): Promise<void> {
		await refreshSkillInstalled();
	},

	// Install the document-session skill into the active repo, then re-check so
	// the "Install skill" prompts clear once it's in place.
	async installSkill(): Promise<void> {
		if (!app.activeRepo) return;
		try {
			await window.api.skill.install(app.activeRepo.id);
			await refreshSkillInstalled();
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
		// `seenFiles` is a SvelteSet, so the in-place mutation is reactive.
		if (next) app.seenFiles.add(filePath);
		else app.seenFiles.delete(filePath);
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		await window.api.state.setFileSeen(app.activeRepo.id, diffContextKey(ctx), filePath, next);
	},

	async clearSeen(): Promise<void> {
		if (!app.activeRepo) return;
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		await window.api.state.clearSeen(app.activeRepo.id, diffContextKey(ctx));
		app.seenFiles.clear();
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
		await window.api.state.setFileCollapsed(app.activeRepo.id, diffContextKey(ctx), filePath, next);
	},

	async checkoutBranch(branch: string): Promise<boolean> {
		if (!app.activeRepo) return false;
		try {
			await window.api.git.checkout(app.activeRepo.id, branch);
			// Re-derive the diff context for tabs that depend on currentBranch.
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
			app.activePR =
				summary ?? (await window.api.github.getPR(app.activeRepo.id, prNumber, ...host));
			app.prComments = {};
			app.pendingComposers = {};
			await actions.setDiffContext({ kind: 'pr', prNumber });
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
							body: c.draft.trim()
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
		} catch (err) {
			c.submitting = false;
			setError(err instanceof Error ? err.message : String(err));
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
		// On the Sessions tab, reload the manifests so an agent's CLI update lands
		// (loadSessions re-opens the active session if one is showing).
		if (app.contextTab === 'sessions') await actions.loadSessions();
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
				console.warn('fetchOrigin failed:', result.error);
			}
			// Mirror refresh(): on the Sessions tab, reload the manifests so an
			// agent's CLI update lands (loadSessions re-opens the active session).
			if (app.contextTab === 'sessions') await actions.loadSessions();
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
		const base = repo.defaultBranch ?? 'main';
		const head = app.currentBranch ?? '';
		if (!head) return;
		const url = `https://github.com/${repo.githubOwner}/${repo.githubRepo}/compare/${encodeURIComponent(
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
			setError(app.push.error);
		} finally {
			// Only release the lock if we're not currently waiting on conflicts.
			if (app.push.stage !== 'conflicts') {
				app.push.inProgress = false;
			}
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
		try {
			await window.api.git.abortMerge(app.activeRepo.id);
			clearConflicts();
			app.push = {
				inProgress: false,
				stage: 'idle',
				intent: 'push',
				error: null
			};
			bumpDiffReload();
			await Promise.all([refreshFiles(), refreshBranches(), refreshPushStatus()]);
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

	// Open the repository's page on GitHub in the default browser. No-op when
	// there's no GitHub remote.
	async openRepoOnGithub(): Promise<void> {
		const repo = app.activeRepo;
		if (!repo?.githubOwner || !repo.githubRepo) return;
		await window.api.shell.openExternal(
			`https://github.com/${repo.githubOwner}/${repo.githubRepo}`
		);
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

	async setAnimationsEnabled(enabled: boolean): Promise<void> {
		app.animationsEnabled = enabled;
		app.prefs = await window.api.state.setPrefs({ animationsEnabled: enabled });
	},

	async setPrMergedBehavior(value: PrMergedBehavior): Promise<void> {
		app.prMergedBehavior = value;
		app.prefs = await window.api.state.setPrefs({ prMergedBehavior: value });
	},

	async setAutoRemoveMergedBranch(value: boolean): Promise<void> {
		app.autoRemoveMergedBranch = value;
		app.prefs = await window.api.state.setPrefs({ autoRemoveMergedBranch: value });
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
		if (app.activeGithubAccount && app.activeRepo?.githubOwner && app.activeRepo.githubRepo) {
			void actions.loadPRs();
		}
	}
};
