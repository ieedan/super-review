import Store from 'electron-store';
import {
	WINDOW_BOUNDS,
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
		recentRepoCount: 5,
		changesetsEnabled: true,
		signCommits: true
	},
	seen: {},
	collapsedFiles: {},
	commitDrafts: {},
	prBranches: {},
	githubAccounts: {},
	activeGithubAccountId: null,
	githubToken: null
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
export function setRepoGithubAccountId(repoId: string, accountId: string | null): RepoInfo | null {
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
	upstream: { owner: string; repo: string } | null
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
	const repos = store.get('repos');
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
	store.set('repos', repos);
	return next;
}

// Remember (or, when link is null, forget) which PR a checked-out branch maps
// to so the UI can resolve it later regardless of head-based API lookups.
export function setPRBranch(repoId: string, branch: string, link: PRBranchLink | null): void {
	const all = store.get('prBranches');
	const forRepo = (all[repoId] ??= {});
	if (link) forRepo[branch] = link;
	else delete forRepo[branch];
	store.set('prBranches', all);
}

export function getPRBranch(repoId: string, branch: string): PRBranchLink | null {
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

// Coerce a stored seen entry into a path→signature map, migrating the legacy
// filePath[] shape (no signatures) written by older builds.
function normalizeSeen(raw: Record<string, string> | string[] | undefined): Record<string, string> {
	if (!raw) return {};
	if (Array.isArray(raw)) return Object.fromEntries(raw.map((p) => [p, '']));
	return { ...raw };
}

export function getSeen(repoId: string, contextKey: string): string[] {
	return Object.keys(normalizeSeen(store.get('seen')[repoId]?.[contextKey]));
}

// The content signatures captured when each path was marked seen. Paths from
// older builds (or marked seen before signatures were tracked) report ''.
export function getSeenSignatures(repoId: string, contextKey: string): Record<string, string> {
	return normalizeSeen(store.get('seen')[repoId]?.[contextKey]);
}

export function setSeen(
	repoId: string,
	contextKey: string,
	filePath: string,
	seen: boolean,
	sig = ''
): void {
	const all = store.get('seen');
	const forRepo = (all[repoId] ??= {});
	const forCtx = normalizeSeen(forRepo[contextKey]);
	if (seen) forCtx[filePath] = sig;
	else delete forCtx[filePath];
	forRepo[contextKey] = forCtx;
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
	collapsed: boolean
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

// Mark that the account's SSH signing key is registered with GitHub, so we skip
// the registration call on subsequent commits. No-op if the account is gone.
export function setSigningKeyRegistered(id: string): void {
	const accounts = store.get('githubAccounts');
	const acct = accounts[id];
	if (!acct) return;
	acct.signingKeyRegistered = true;
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
