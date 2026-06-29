import Store from 'electron-store';
import {
	DEFAULT_FILE_HEADER_ITEMS,
	DEFAULT_HEADER_ITEMS,
	DEFAULT_SIDEBAR_CONTROLS,
	WINDOW_BOUNDS,
	type ChangedFile,
	type CommitDraft,
	type GithubAccount,
	type PRSource,
	type RepoInfo,
	type UserPrefs
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
import {
	emptyStoredStats,
	projectStats,
	type RepoUsageStats,
	type StoredRepoStats
} from '@super-review/core/usage-stats';

export interface StoredGithubAccount extends GithubAccount {
	token: string;
	// Space-separated OAuth scopes the token was granted, captured from GitHub's
	// `x-oauth-scopes` response header. Used to tell whether the token can manage
	// SSH signing keys (`write:ssh_signing_key`) without an extra round-trip.
	// Absent on accounts authed before scope capture existed.
	scopes?: string;
	// Set once the account's SSH signing key has been registered with GitHub
	// (POST /user/ssh_signing_keys succeeded, or returned "already exists"), so we
	// don't re-POST on every commit.
	signingKeyRegistered?: boolean;
}

interface Schema {
	repos: Record<string, RepoInfo>;
	prefs: UserPrefs;
	// seen[repoId][contextKey] = { [filePath]: contentSig }. The signature is the
	// file's diff fingerprint at mark-seen time, used to clear the mark when the
	// file later changes (see UserPrefs.unmarkSeenOnChange). Older builds stored a
	// bare filePath[]; normalizeSeen migrates that shape on read (empty sigs).
	seen: Record<string, Record<string, Record<string, string>>>;
	// collapsedFiles[repoId][contextKey] = filePath[]
	collapsedFiles: Record<string, Record<string, string[]>>;
	// fileLists[repoId][contextKey] = the last-computed changed-file list for that
	// context. Cached so a cold start can paint the sidebar (and its seen markers,
	// which read from `seen`) instantly while the slow git diff revalidates in the
	// background, instead of sitting on a spinner. Stale-while-revalidate: the next
	// refreshFiles overwrites it with fresh git output.
	fileLists: Record<string, Record<string, ChangedFile[]>>;
	// branchBases[repoId][branch] = the non-default base ref the Branch diff last
	// used for that checked-out branch (a pinned `pr/<n>/base`). Remembered so a
	// cold start can target it from the first paint instead of defaulting to the
	// local default branch and flipping ~1s later when the network PR lookup pins
	// the base — which would briefly load seen markers under the wrong context key.
	branchBases: Record<string, Record<string, string>>;
	// Unsent commit message drafts, keyed by repoId.
	commitDrafts: Record<string, CommitDraft>;
	// PR associations for checked-out branches: prBranches[repoId][branch].
	prBranches: Record<string, Record<string, PRBranchLink>>;
	// Multi-account GitHub auth. Keyed by account id (GitHub user id as string).
	githubAccounts: Record<string, StoredGithubAccount>;
	activeGithubAccountId: string | null;
	// Legacy single-token field — migrated lazily, see github-service.
	githubToken: string | null;
	// Local usage statistics keyed by repoId. Purely on-disk; never sent anywhere.
	stats: Record<string, StoredRepoStats>;
}

const defaults: Schema = {
	repos: {},
	prefs: {
		viewMode: 'split',
		diffLayout: 'scroll',
		theme: 'dark',
		diffTheme: 'pierre',
		accent: 'super',
		unstagedFileListLayout: 'tree',
		branchFileListLayout: 'tree',
		showFileIcons: true,
		openFileOnArrowNav: true,
		codeFont: 'system',
		uiFont: 'system',
		maxDiffLines: 1500,
		hiddenDiffPatterns: DEFAULT_HIDDEN_DIFF_PATTERNS,
		customFileIcons: [],
		animations: 'accents',
		prMergedBehavior: 'prompt',
		autoRemoveMergedBranch: false,
		unmarkSeenOnChange: true,
		hotkeys: DEFAULT_HOTKEYS,
		windowWidth: WINDOW_BOUNDS.defaultWidth,
		windowHeight: WINDOW_BOUNDS.defaultHeight,
		startMaximized: false,
		sidebarCollapsed: false,
		commentsSidebarOpen: false,
		commentsSidebarTab: 'comments',
		conversationFullscreen: false,
		recentRepoCount: 5,
		changesetsEnabled: true,
		signCommits: true,
		headerItems: DEFAULT_HEADER_ITEMS,
		fileHeaderItems: DEFAULT_FILE_HEADER_ITEMS,
		sidebarControls: DEFAULT_SIDEBAR_CONTROLS
	},
	seen: {},
	collapsedFiles: {},
	fileLists: {},
	branchBases: {},
	commitDrafts: {},
	prBranches: {},
	githubAccounts: {},
	activeGithubAccountId: null,
	githubToken: null,
	stats: {}
};

export const store = new Store<Schema>({ defaults, name: 'super-review' });

// conf (electron-store's base) keeps NO in-memory copy: every `store.get` does
// `fs.readFileSync` + `JSON.parse` of the whole config file, and every `store.set`
// re-parses it before writing. refreshFiles reads seen/collapsed/file-list state
// on every refresh, so that re-parsed the entire (now file-list-bloated) config
// each time — the reason seen markers crawled in. So we mirror the config in
// memory: parse the file once, serve every read from the mirror, and write the
// mirror back on mutation. Safe because this main process is the sole writer.
let cache: Schema | null = null;

function db(): Schema {
	if (!cache) {
		cache = { ...defaults, ...(store.store as Partial<Schema>) };
		if (migrateBranchReviewKeys()) flush();
	}
	return cache;
}

// One-time migration: review state (seen / collapsed files) used to be keyed by
// the full branch diff `branch:<base>..<head>`, which made it depend on the
// async-resolved base. It's now keyed by `branch:<head>` (see reviewContextKey),
// so fold any legacy entries into the new key — unioning, since the same head
// may have been stored under several bases (the default branch, then a PR base).
// Returns whether anything moved (so the caller persists the result).
function migrateBranchReviewKeys(): boolean {
	if (!cache) return false;
	let changed = false;
	for (const byCtx of Object.values(cache.seen)) {
		for (const key of Object.keys(byCtx)) {
			const head = legacyBranchHead(key);
			if (!head) continue;
			const newKey = `branch:${head}`;
			byCtx[newKey] = { ...normalizeSeen(byCtx[key]), ...normalizeSeen(byCtx[newKey]) };
			delete byCtx[key];
			changed = true;
		}
	}
	for (const byCtx of Object.values(cache.collapsedFiles)) {
		for (const key of Object.keys(byCtx)) {
			const head = legacyBranchHead(key);
			if (!head) continue;
			const newKey = `branch:${head}`;
			byCtx[newKey] = [...new Set([...(byCtx[newKey] ?? []), ...byCtx[key]])];
			delete byCtx[key];
			changed = true;
		}
	}
	return changed;
}

// The head of a legacy `branch:<base>..<head>` review key, or null if `key` is
// already the new head-only form (or another context kind). Refs don't contain
// "..", so the last "<base>..<head>" split is unambiguous.
function legacyBranchHead(key: string): string | null {
	if (!key.startsWith('branch:') || !key.includes('..')) return null;
	return key.slice(key.lastIndexOf('..') + 2);
}

// Persist the whole mirror in a single write. conf's `store` setter writes
// without re-reading, so this is one `writeFileSync`, not the parse-then-write
// that `store.set(key, value)` would do.
function flush(): void {
	if (pendingFlush) {
		clearTimeout(pendingFlush);
		pendingFlush = null;
	}
	if (cache) store.store = cache;
}

// Coalesce the file-list cache writes: setCachedFileList runs on every refresh
// and the config file is large, so debounce rather than rewrite it each time. A
// pending write also rides along on the next immediate flush, and on quit.
let pendingFlush: ReturnType<typeof setTimeout> | null = null;
function flushSoon(): void {
	if (pendingFlush) return;
	pendingFlush = setTimeout(flush, 500);
}

// Flush any debounced write synchronously — call from the app's before-quit so a
// pending file-list cache write isn't lost on exit.
export function flushStore(): void {
	flush();
}

// Prime the mirror at startup so the one unavoidable file parse happens at launch
// rather than on the first refresh (where it would stall the seen-state read).
db();

export function upsertRepo(repo: RepoInfo): void {
	db().repos[repo.id] = repo;
	flush();
}

export function listRepos(): RepoInfo[] {
	return Object.values(db().repos).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function removeRepo(id: string): void {
	const d = db();
	delete d.repos[id];
	delete d.seen[id];
	delete d.collapsedFiles[id];
	delete d.fileLists[id];
	delete d.branchBases[id];
	delete d.commitDrafts[id];
	delete d.prBranches[id];
	delete d.stats[id];
	if (d.prefs.activeRepoId === id) d.prefs = { ...d.prefs, activeRepoId: undefined };
	flush();
}

export function getRepo(id: string): RepoInfo | null {
	return db().repos[id] ?? null;
}

// Pin (or unpin, when accountId is null) the GitHub account a project uses.
export function setRepoGithubAccountId(repoId: string, accountId: string | null): RepoInfo | null {
	const repos = db().repos;
	const repo = repos[repoId];
	if (!repo) return null;
	const next: RepoInfo = { ...repo };
	if (accountId) next.githubAccountId = accountId;
	else delete next.githubAccountId;
	repos[repoId] = next;
	flush();
	return next;
}

// Persist (or clear) the fork's upstream/parent repo on a project.
export function setRepoUpstream(
	repoId: string,
	upstream: { owner: string; repo: string } | null
): RepoInfo | null {
	const repos = db().repos;
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
	flush();
	return next;
}

// Record that a project was converted to a fork: `origin` now points at the
// user's fork (so `githubOwner/githubRepo/remoteUrl` describe the fork). When
// `upstream` is given (contributing to the parent), it's kept as the upstream so
// the PR list / "Create PR" / "Update from upstream" target the parent; null
// (working on the fork "for my own purposes") clears any upstream.
export function setRepoFork(
	repoId: string,
	fork: { owner: string; repo: string; url: string },
	upstream: { owner: string; repo: string } | null
): RepoInfo | null {
	const repos = db().repos;
	const repo = repos[repoId];
	if (!repo) return null;
	const next: RepoInfo = {
		...repo,
		githubOwner: fork.owner,
		githubRepo: fork.repo,
		remoteUrl: fork.url
	};
	if (upstream) {
		next.upstreamOwner = upstream.owner;
		next.upstreamRepo = upstream.repo;
	} else {
		delete next.upstreamOwner;
		delete next.upstreamRepo;
	}
	repos[repoId] = next;
	flush();
	return next;
}

// Remember (or, when link is null, forget) which PR a checked-out branch maps
// to so the UI can resolve it later regardless of head-based API lookups.
export function setPRBranch(repoId: string, branch: string, link: PRBranchLink | null): void {
	const all = db().prBranches;
	const forRepo = (all[repoId] ??= {});
	if (link) forRepo[branch] = link;
	else delete forRepo[branch];
	flush();
}

export function getPRBranch(repoId: string, branch: string): PRBranchLink | null {
	return db().prBranches[repoId]?.[branch] ?? null;
}

export function getPrefs(): UserPrefs {
	// Merge with defaults so prefs files saved by older builds still report
	// values for fields added in later releases.
	const merged = { ...defaults.prefs, ...db().prefs };
	// Older builds persisted theme: 'system'; collapse that to the default.
	if ((merged.theme as string) !== 'light' && (merged.theme as string) !== 'dark') {
		merged.theme = defaults.prefs.theme;
	}
	// Merge per-action so bindings added in later releases get their defaults
	// even when an older prefs file already has a (partial) hotkeys object.
	merged.hotkeys = { ...defaults.prefs.hotkeys, ...merged.hotkeys };
	// Same per-key merge for header item visibility, so controls added later
	// default to visible even when an older prefs file has a partial object.
	merged.headerItems = { ...defaults.prefs.headerItems, ...merged.headerItems };
	// And for the per-file diff header controls.
	merged.fileHeaderItems = { ...defaults.prefs.fileHeaderItems, ...merged.fileHeaderItems };
	// And for the sidebar controls-row buttons.
	merged.sidebarControls = { ...defaults.prefs.sidebarControls, ...merged.sidebarControls };
	return merged;
}

export function setPrefs(patch: Partial<UserPrefs>): UserPrefs {
	const next = { ...defaults.prefs, ...db().prefs, ...patch };
	db().prefs = next;
	flush();
	return next;
}

// Coerce a stored seen entry into a path→signature map, migrating the legacy
// filePath[] shape (no signatures) written by older builds.
function normalizeSeen(raw: Record<string, string> | string[] | undefined): Record<string, string> {
	if (!raw) return {};
	if (Array.isArray(raw)) return Object.fromEntries(raw.map((p) => [p, '']));
	return { ...raw };
}

export function getSeen(repoId: string, contextKey: string): string[] {
	return Object.keys(normalizeSeen(db().seen[repoId]?.[contextKey]));
}

// The content signatures captured when each path was marked seen. Paths from
// older builds (or marked seen before signatures were tracked) report ''.
export function getSeenSignatures(repoId: string, contextKey: string): Record<string, string> {
	return normalizeSeen(db().seen[repoId]?.[contextKey]);
}

export function setSeen(
	repoId: string,
	contextKey: string,
	filePath: string,
	seen: boolean,
	sig = ''
): void {
	const all = db().seen;
	const forRepo = (all[repoId] ??= {});
	const forCtx = normalizeSeen(forRepo[contextKey]);
	if (seen) forCtx[filePath] = sig;
	else delete forCtx[filePath];
	forRepo[contextKey] = forCtx;
	flush();
}

export function clearSeen(repoId: string, contextKey: string): void {
	const all = db().seen;
	if (all[repoId]) {
		delete all[repoId][contextKey];
		flush();
	}
}

export function getCollapsedFiles(repoId: string, contextKey: string): string[] {
	return db().collapsedFiles[repoId]?.[contextKey] ?? [];
}

export function setFileCollapsed(
	repoId: string,
	contextKey: string,
	filePath: string,
	collapsed: boolean
): void {
	const all = db().collapsedFiles;
	const forRepo = (all[repoId] ??= {});
	const forCtx = new Set(forRepo[contextKey] ?? []);
	if (collapsed) forCtx.add(filePath);
	else forCtx.delete(filePath);
	forRepo[contextKey] = [...forCtx];
	flush();
}

export function setFilesCollapsed(
	repoId: string,
	contextKey: string,
	filePaths: string[],
	collapsed: boolean
): void {
	const all = db().collapsedFiles;
	const forRepo = (all[repoId] ??= {});
	const forCtx = new Set(forRepo[contextKey] ?? []);
	if (collapsed) for (const p of filePaths) forCtx.add(p);
	else for (const p of filePaths) forCtx.delete(p);
	forRepo[contextKey] = [...forCtx];
	flush();
}

export function clearCollapsedFiles(repoId: string, contextKey: string): void {
	const all = db().collapsedFiles;
	if (all[repoId]) {
		delete all[repoId][contextKey];
		flush();
	}
}

// The last-computed changed-file list for a context, or [] if we've never
// cached one. Lets the renderer paint the sidebar instantly on a cold start.
export function getCachedFileList(repoId: string, contextKey: string): ChangedFile[] {
	return db().fileLists[repoId]?.[contextKey] ?? [];
}

// Cap cached contexts per repo so the file-list cache (the largest thing in the
// store) can't grow without bound across every branch/PR ever viewed — which
// would slowly re-bloat the config and drag the startup parse back down.
const MAX_CACHED_CONTEXTS_PER_REPO = 40;

export function setCachedFileList(repoId: string, contextKey: string, files: ChangedFile[]): void {
	const all = db().fileLists;
	const forRepo = (all[repoId] ??= {});
	if (files.length) {
		// Re-insert at the end so it counts as most-recent for FIFO eviction.
		delete forRepo[contextKey];
		forRepo[contextKey] = files;
		const keys = Object.keys(forRepo);
		for (const stale of keys.slice(0, keys.length - MAX_CACHED_CONTEXTS_PER_REPO)) {
			delete forRepo[stale];
		}
	} else {
		delete forRepo[contextKey];
	}
	// Debounced: this runs on every refresh and the config file is large.
	flushSoon();
}

// The non-default base ref the Branch diff last used for a checked-out branch,
// or null if none was remembered (the branch has no PR, or was never reviewed).
export function getBranchBase(repoId: string, branch: string): string | null {
	return db().branchBases[repoId]?.[branch] ?? null;
}

// Remember the base ref for a branch, or forget it when base is null (the diff
// fell back to the default branch — e.g. the PR was merged/closed).
export function setBranchBase(repoId: string, branch: string, base: string | null): void {
	const all = db().branchBases;
	const forRepo = (all[repoId] ??= {});
	if (base) forRepo[branch] = base;
	else delete forRepo[branch];
	flush();
}

export function getCommitDraft(repoId: string): CommitDraft {
	return db().commitDrafts[repoId] ?? { summary: '', description: '' };
}

export function setCommitDraft(repoId: string, draft: CommitDraft): void {
	const all = db().commitDrafts;
	if (!draft.summary && !draft.description) {
		delete all[repoId];
	} else {
		all[repoId] = draft;
	}
	flush();
}

export function getLegacyGithubToken(): string | null {
	return db().githubToken;
}

export function clearLegacyGithubToken(): void {
	db().githubToken = null;
	flush();
}

export function listGithubAccounts(): StoredGithubAccount[] {
	return Object.values(db().githubAccounts).sort((a, b) => a.addedAt - b.addedAt);
}

export function getGithubAccount(id: string): StoredGithubAccount | null {
	return db().githubAccounts[id] ?? null;
}

export function getActiveGithubAccountId(): string | null {
	return db().activeGithubAccountId;
}

export function getActiveGithubAccount(): StoredGithubAccount | null {
	const id = getActiveGithubAccountId();
	if (!id) return null;
	return getGithubAccount(id);
}

export function setActiveGithubAccountId(id: string | null): void {
	db().activeGithubAccountId = id;
	flush();
}

export function upsertGithubAccount(account: StoredGithubAccount): void {
	db().githubAccounts[account.id] = account;
	flush();
}

// Mark that the account's SSH signing key is registered with GitHub, so we skip
// the registration call on subsequent commits. No-op if the account is gone.
export function setSigningKeyRegistered(id: string): void {
	const acct = db().githubAccounts[id];
	if (!acct) return;
	acct.signingKeyRegistered = true;
	flush();
}

export function removeGithubAccount(id: string): void {
	const d = db();
	delete d.githubAccounts[id];
	if (getActiveGithubAccountId() === id) {
		const remaining = Object.keys(d.githubAccounts);
		d.activeGithubAccountId = remaining[0] ?? null;
	}
	// Unpin any project that referenced the removed account so it falls back to
	// the app-wide default.
	for (const repo of Object.values(d.repos)) {
		if (repo.githubAccountId === id) delete repo.githubAccountId;
	}
	flush();
}

// --- Local usage statistics --------------------------------------------------
// All on-disk, never sent anywhere. Deduped counts (files by content sig,
// sessions by id) keep their backing sets so re-recording the same key is a
// no-op; the rest are plain counters bumped from their own IPC handlers.

function ensureStats(repoId: string): StoredRepoStats {
	const d = db();
	let s = d.stats[repoId];
	if (!s) {
		s = emptyStoredStats();
		d.stats[repoId] = s;
	}
	return s;
}

// Stamp the repo's "active since" the first time it records any activity.
function markUsed(s: StoredRepoStats): void {
	if (s.firstUsedAt === null) s.firstUsedAt = Date.now();
}

export function getStats(repoId: string): RepoUsageStats {
	const s = db().stats[repoId];
	return s ? projectStats(s) : projectStats(emptyStoredStats());
}

export function getAllStats(): Record<string, RepoUsageStats> {
	const out: Record<string, RepoUsageStats> = {};
	for (const [id, s] of Object.entries(db().stats)) out[id] = projectStats(s);
	return out;
}

// Record a file marked seen, deduped by content signature. Only the first time a
// given content is seen does it count toward filesReviewed / locReviewed.
export function recordFileReviewed(repoId: string, sig: string, loc: number): void {
	if (!sig) return;
	const s = ensureStats(repoId);
	if (s.reviewedSigs.includes(sig)) return;
	s.reviewedSigs.push(sig);
	s.locReviewed += Math.max(0, loc);
	markUsed(s);
	flush();
}

// Record a guided-tour session opened, deduped by session id.
export function recordSessionReviewed(repoId: string, sessionId: string): void {
	if (!sessionId) return;
	const s = ensureStats(repoId);
	if (s.reviewedSessionIds.includes(sessionId)) return;
	s.reviewedSessionIds.push(sessionId);
	markUsed(s);
	flush();
}

export type StatCounter = 'prsMerged' | 'branchesCreated' | 'commitsAuthored' | 'commentsWritten';

// Increment one of the plain counters by one. Called from the main-process
// handler that performs the action (so it only counts real successes).
export function bumpStat(repoId: string, key: StatCounter): void {
	const s = ensureStats(repoId);
	s[key] += 1;
	markUsed(s);
	flush();
}
