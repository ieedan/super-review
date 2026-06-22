import os from 'node:os';
import { Octokit } from '@octokit/rest';
import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import { shell } from 'electron';
import type {
	CommitAuthorIdentity,
	CommitSigning,
	DeviceFlowStart,
	DeviceFlowStatus,
	FeedbackInput,
	FeedbackResult,
	GitIdentity,
	GithubAccount,
	GithubAuthError,
	GithubOrg,
	NewReviewCommentInput,
	PRConversationItem,
	PRConversationReference,
	PRConversationReview,
	PRCheck,
	PRChecksState,
	PRChecksSummary,
	PRDeployment,
	PRMergeMethod,
	PRMergeResult,
	PRReviewComment,
	PRSummary,
	ReleaseNotes,
	ReleaseNotesResult,
	ReleaseNotesRangeResult
} from '@shared/types.js';
import {
	checkSshSigningSupported,
	setGitCredentialProvider,
	type GitCredentials
} from '@super-review/core';
import {
	clearLegacyGithubToken,
	getActiveGithubAccount,
	getGithubAccount,
	getLegacyGithubToken,
	getPrefs,
	listGithubAccounts,
	removeGithubAccount as storeRemoveAccount,
	setActiveGithubAccountId,
	setSigningKeyRegistered,
	upsertGithubAccount,
	type StoredGithubAccount
} from './store.js';
import { ensureSigningKey, readSigningPublicKey, removeSigningKey } from './signing-service.js';

// Default GitHub OAuth client ID for "GitHub CLI" - public, ships with `gh`.
// Users can override via env var for self-hosted GHE later.
const CLIENT_ID = process.env.SUPER_REVIEW_GH_CLIENT_ID ?? '178c6fc778ccc68e1d6a';
// `write:ssh_signing_key` lets the app register each account's commit-signing
// key so signed commits show "Verified" on GitHub. Tokens minted before this
// scope was added lack it — see flagAccountsMissingSigningScope.
const SCOPES = ['repo', 'read:user', 'write:ssh_signing_key'];
const SIGNING_SCOPE = 'write:ssh_signing_key';

// In-app feedback always opens an issue on the project's own repository — never
// whatever repo the user happens to be reviewing. Overridable via env for forks
// or self-hosted builds; defaults to the (currently private) project repo.
const FEEDBACK_REPO = (() => {
	const override = process.env.SUPER_REVIEW_FEEDBACK_REPO?.split('/');
	if (override?.length === 2 && override[0] && override[1]) {
		return { owner: override[0], repo: override[1] };
	}
	return { owner: 'ieedan', repo: 'super-review' };
})();
// The label a triage workflow watches for. Created on the fly by GitHub if it
// doesn't exist yet.
const FEEDBACK_LABEL = 'in-app-feedback';
const FEEDBACK_CATEGORY_LABELS: Record<FeedbackInput['category'], string> = {
	bug: 'Bug',
	idea: 'Idea',
	other: 'Feedback'
};

interface PendingDeviceFlow {
	cancel: () => void;
}

let pending: PendingDeviceFlow | null = null;
let lastStatus: DeviceFlowStatus = { state: 'pending' };
let migrationDone = false;

function publicAccount(a: StoredGithubAccount): GithubAccount {
	const { token: _token, ...rest } = a;
	void _token;
	return rest;
}

async function fetchAccountForToken(token: string): Promise<StoredGithubAccount> {
	const o = new Octokit({ auth: token });
	const res = await o.users.getAuthenticated();
	const u = res.data;
	// GitHub echoes the token's granted scopes here; capture them so we can tell
	// whether this token can register signing keys without an extra request.
	const scopes = (res.headers['x-oauth-scopes'] as string | undefined) ?? '';
	return {
		id: String(u.id),
		login: u.login,
		name: u.name ?? undefined,
		avatarUrl: u.avatar_url ?? undefined,
		addedAt: Date.now(),
		token,
		scopes
	};
}

// Whether the account's token carries the scope needed to register a signing
// key with GitHub. Accounts authed before scope capture (scopes === undefined)
// are treated as missing it so the user is prompted to re-authenticate once.
function hasSigningScope(account: StoredGithubAccount): boolean {
	const granted = account.scopes?.split(',').map((s) => s.trim());
	return granted?.includes(SIGNING_SCOPE) ?? false;
}

// One-shot migration of the legacy single-token field into the accounts map.
// If the fetch fails (offline, revoked token), drop the legacy token so we
// don't keep retrying on every call.
async function migrateLegacyTokenOnce(): Promise<void> {
	if (migrationDone) return;
	migrationDone = true;
	const legacy = getLegacyGithubToken();
	if (!legacy) return;
	if (listGithubAccounts().length > 0) {
		clearLegacyGithubToken();
		return;
	}
	try {
		const account = await fetchAccountForToken(legacy);
		upsertGithubAccount(account);
		setActiveGithubAccountId(account.id);
	} catch {
		// ignore — user will sign in again
	} finally {
		clearLegacyGithubToken();
	}
}

export async function listAccounts(): Promise<GithubAccount[]> {
	await migrateLegacyTokenOnce();
	return listGithubAccounts().map(publicAccount);
}

export async function getActiveAccount(): Promise<GithubAccount | null> {
	await migrateLegacyTokenOnce();
	const a = getActiveGithubAccount();
	return a ? publicAccount(a) : null;
}

export async function setActiveAccount(id: string): Promise<GithubAccount | null> {
	const a = getGithubAccount(id);
	if (!a) return null;
	setActiveGithubAccountId(id);
	return publicAccount(a);
}

export async function removeAccount(id: string): Promise<void> {
	storeRemoveAccount(id);
	// Drop the account's signing key so we don't leave an orphaned key pair.
	await removeSigningKey(id);
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
	if (pending) pending.cancel();
	lastStatus = { state: 'pending' };

	let openedResolve: ((v: DeviceFlowStart) => void) | null = null;
	const openedPromise = new Promise<DeviceFlowStart>((resolve) => {
		openedResolve = resolve;
	});

	let cancelled = false;
	pending = {
		cancel: () => {
			cancelled = true;
		}
	};

	const auth = createOAuthDeviceAuth({
		clientType: 'oauth-app',
		clientId: CLIENT_ID,
		scopes: SCOPES,
		onVerification(verification) {
			openedResolve?.({
				userCode: verification.user_code,
				verificationUri: verification.verification_uri,
				expiresInSec: verification.expires_in,
				intervalSec: verification.interval
			});
			void shell.openExternal(verification.verification_uri);
		}
	});

	// Kick off auth in background — it will poll until success or cancel.
	void (async () => {
		try {
			const result = await auth({ type: 'oauth' });
			if (cancelled) return;
			const account = await fetchAccountForToken(result.token);
			upsertGithubAccount(account);
			setActiveGithubAccountId(account.id);
			// Re-signing in mints a fresh token (with the current scope set) for the
			// same account id — clear any auth-failure flag, including a 'scope' one,
			// so the renderer's prompt goes away.
			clearAuthError(account.id);
			lastStatus = { state: 'success', account: publicAccount(account) };
		} catch (err) {
			if (cancelled) return;
			const message = err instanceof Error ? err.message : String(err);
			lastStatus = { state: 'error', message };
		} finally {
			pending = null;
		}
	})();

	return openedPromise;
}

export function pollDeviceFlow(): DeviceFlowStatus {
	return lastStatus;
}

export function cancelDeviceFlow(): void {
	if (pending) {
		pending.cancel();
		pending = null;
	}
	lastStatus = { state: 'pending' };
}

// Resolve which account a call authenticates as: the explicitly requested
// account (a project's pinned account) when it still exists, otherwise the
// app-wide default.
function resolveAccount(accountId?: string | null): StoredGithubAccount {
	const pinned = accountId ? getGithubAccount(accountId) : null;
	const account = pinned ?? getActiveGithubAccount();
	if (!account) throw new Error('Not authenticated with GitHub. Sign in first.');
	return account;
}

// ─── Auth-failure tracking ──────────────────────────────────────────────────
// OAuth device-flow tokens don't expire on their own, but they can be revoked
// (by the user, an org admin, or GitHub after a year of disuse), and a SAML
// org's session can lapse and need re-authorizing. Every Octokit request is
// hooked so the first failure flags the account and the next success (or a
// re-sign-in) clears it — the renderer is notified either way so it can prompt
// the user instead of silently degrading.

const authErrors = new Map<string, GithubAuthError>();
let authErrorsListener: ((errors: GithubAuthError[]) => void) | null = null;

export function onAuthErrorsChanged(listener: (errors: GithubAuthError[]) => void): void {
	authErrorsListener = listener;
}

export function getAuthErrors(): GithubAuthError[] {
	return [...authErrors.values()];
}

// 401 → the token itself no longer authenticates (revoked or expired).
// 403 with an X-GitHub-SSO header → the token is fine, but a SAML-enforcing
// organization requires the session to be re-authorized in the browser.
// Anything else (404, rate limit, network) is not an auth problem.
function authFailureReason(err: unknown): 'revoked' | 'sso' | null {
	const status = (err as { status?: number }).status;
	if (status === 401) return 'revoked';
	if (status === 403) {
		const headers = (err as { response?: { headers?: Record<string, unknown> } }).response?.headers;
		if (headers?.['x-github-sso']) return 'sso';
	}
	return null;
}

function noteRequestFailed(account: StoredGithubAccount, err: unknown): void {
	const reason = authFailureReason(err);
	if (!reason) return;
	if (authErrors.get(account.id)?.reason === reason) return;
	authErrors.set(account.id, { accountId: account.id, login: account.login, reason });
	authErrorsListener?.(getAuthErrors());
}

function noteRequestSucceeded(accountId: string): void {
	// A 'scope' error means the token is missing an OAuth scope, not that it's
	// dead. A request succeeding doesn't grant the scope — only re-authenticating
	// does — so leave a 'scope' error in place; clearAuthError handles re-auth.
	if (authErrors.get(accountId)?.reason === 'scope') return;
	if (authErrors.delete(accountId)) authErrorsListener?.(getAuthErrors());
}

// Unconditionally clear an account's auth error. Used after a re-sign-in, which
// mints a fresh token with the current scope set — so even a 'scope' error is
// resolved.
function clearAuthError(accountId: string): void {
	if (authErrors.delete(accountId)) authErrorsListener?.(getAuthErrors());
}

// Flag accounts whose token predates the signing scope so the UI prompts a
// one-time re-sign-in (which grants it). Only when signing is enabled, and never
// over an existing revoked/SSO error (that's the more urgent fix). Called after
// token probing in validateAccounts.
function flagAccountsMissingSigningScope(): void {
	if (!getPrefs().signCommits) return;
	let changed = false;
	for (const account of listGithubAccounts()) {
		if (hasSigningScope(account)) continue;
		if (authErrors.has(account.id)) continue;
		authErrors.set(account.id, { accountId: account.id, login: account.login, reason: 'scope' });
		changed = true;
	}
	if (changed) authErrorsListener?.(getAuthErrors());
}

// Probe each stored account's token with a cheap /user call so a token that
// died while the app was closed is flagged at startup rather than the first
// time some feature happens to need it. Non-auth failures (offline, …) are
// ignored — the hooks only flag 401/SSO.
export async function validateAccounts(): Promise<GithubAuthError[]> {
	await migrateLegacyTokenOnce();
	await Promise.all(
		listGithubAccounts().map((account) =>
			octokit(account)
				.users.getAuthenticated()
				.catch(() => {})
		)
	);
	flagAccountsMissingSigningScope();
	return getAuthErrors();
}

function octokit(account: StoredGithubAccount): Octokit {
	const o = new Octokit({ auth: account.token });
	o.hook.after('request', () => noteRequestSucceeded(account.id));
	o.hook.error('request', (err) => {
		noteRequestFailed(account, err);
		throw err;
	});
	return o;
}

// How many authors we probe against the GitHub API at once. A long branch can
// have dozens of distinct author emails the email alone can't decode (the
// History tab resolves the whole list at once), and firing every `getCommit` in
// parallel both saturates the main process and trips GitHub's secondary (abuse)
// rate limit — a stalled main process freezes all IPC, so the whole app appears
// to hang. A small pool keeps resolution responsive and background-y instead.
const AUTHOR_RESOLVE_CONCURRENCY = 6;

// Run `task` over `items` with at most `limit` running at once. Workers pull
// from a shared cursor, so a slow author doesn't hold up the rest of the pool.
async function mapPooled<T>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<void>
): Promise<void> {
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (cursor < items.length) {
			const item = items[cursor++];
			await task(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Resolve commit authors to GitHub accounts the way GitHub's commit list does:
// ask the API for a specific commit and read the `author` it mapped the commit
// email to. The email alone isn't enough — `noreply@anthropic.com`, say, only
// resolves to the `claude` account through GitHub's user database. Each candidate
// pairs an author email with a few of their commit SHAs (newest first); we probe
// them in order and take the first that GitHub can resolve, so an unpushed tip
// commit (which the API doesn't know) falls through to an older pushed one. The
// per-SHA `getCommit` calls (one per author, not per commit) keep this cheap, and
// the pool caps how many run at once so a big branch can't flood the API.
export async function resolveCommitAuthors(
	owner: string,
	repo: string,
	candidates: { email: string; shas: string[] }[],
	accountId?: string | null
): Promise<Record<string, CommitAuthorIdentity>> {
	const viewer = resolveAccount(accountId);
	const o = octokit(viewer);
	const out: Record<string, CommitAuthorIdentity> = {};
	await mapPooled(candidates, AUTHOR_RESOLVE_CONCURRENCY, async ({ email, shas }) => {
		for (const sha of shas.slice(0, 5)) {
			try {
				const res = await o.repos.getCommit({ owner, repo, ref: sha });
				const author = res.data.author;
				if (author?.login) {
					out[email.trim().toLowerCase()] = {
						login: author.login,
						avatarUrl: author.avatar_url
					};
					return;
				}
			} catch {
				// SHA not on GitHub (unpushed) or a transient error — try the next.
			}
		}
	});
	return out;
}

// ─── Release notes (package.json hover card "What's new" disclosure) ─────────
// Fetches a package's GitHub release notes. Unlike the methods above this isn't
// tied to a project's pinned account: it's a read of public release data for
// whatever npm package is under the pointer. We authenticate with the active
// account's token when there is one (5000 req/hr and access to private repos the
// user can see), and fall back to an unauthenticated client (60 req/hr) so the
// feature still works signed-out. We deliberately DON'T use the auth-error-hooked
// `octokit()` here: a 404/rate-limit on someone else's repo isn't a signal that
// the user's own token is bad.

interface ReleaseNotesCacheEntry {
	at: number;
	result: ReleaseNotesResult;
}
// `owner/repo@version` → result. Process-wide; mirrors npm-service's cache so
// repeated hovers (and renderer reloads) don't re-hit the GitHub API.
const releaseNotesCache = new Map<string, ReleaseNotesCacheEntry>();
const RELEASE_NOTES_TTL_MS = 60 * 60 * 1000;

// Pull `owner` / `repo` out of a normalized https repository URL, but only for
// github.com (the only host we can query the Releases API for). Returns null for
// GitLab/Bitbucket/self-hosted so the caller degrades to no release notes.
function parseGithubRepo(repositoryUrl: string): { owner: string; repo: string } | null {
	let url: URL;
	try {
		url = new URL(repositoryUrl);
	} catch {
		return null;
	}
	if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
	const parts = url.pathname.split('/').filter(Boolean);
	if (parts.length < 2) return null;
	const owner = parts[0];
	const repo = parts[1].replace(/\.git$/, '');
	if (!owner || !repo) return null;
	return { owner, repo };
}

function releaseNotesOctokit(): Octokit {
	const account = getActiveGithubAccount();
	return account ? new Octokit({ auth: account.token }) : new Octokit();
}

export async function getReleaseNotes(
	repositoryUrl: string,
	packageName: string,
	version: string
): Promise<ReleaseNotesResult> {
	const parsed = parseGithubRepo(repositoryUrl);
	if (!parsed || !version) return { ok: true, release: null };
	const { owner, repo } = parsed;

	// Keyed by package (not just repo): a monorepo publishes many packages from
	// one repo, each with its own `name@version` release.
	const cacheKey = `${packageName}@${version}`;
	const cached = releaseNotesCache.get(cacheKey);
	if (cached && Date.now() - cached.at < RELEASE_NOTES_TTL_MS) return cached.result;

	const o = releaseNotesOctokit();
	// Single-package repos tag releases `v1.2.3` or the bare version; monorepos
	// (Changesets/Lerna style, e.g. svelte) tag `name@1.2.3`. Try each; a miss is
	// a 404, which just means "try the next form / none match".
	const tags = [`v${version}`, version, `${packageName}@${version}`];
	try {
		let result: ReleaseNotesResult = { ok: true, release: null };
		for (const tag of tags) {
			try {
				const { data } = await o.repos.getReleaseByTag({ owner, repo, tag });
				result = { ok: true, release: mapRelease(data) };
				break;
			} catch (err) {
				if ((err as { status?: number }).status === 404) continue;
				throw err;
			}
		}
		releaseNotesCache.set(cacheKey, { at: Date.now(), result });
		return result;
	} catch (err) {
		// Don't cache transient errors (rate limit / network), so the next hover
		// retries. A 404 was already handled above as "no matching release".
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Could not load release notes: ${message}` };
	}
}

// The fields we read off a GitHub release (from getReleaseByTag or listReleases).
interface RawRelease {
	tag_name: string;
	name?: string | null;
	body?: string | null;
	html_url: string;
	published_at?: string | null;
	draft?: boolean;
}

function mapRelease(data: RawRelease): ReleaseNotes {
	return {
		tag: data.tag_name,
		name: data.name ?? undefined,
		body: data.body ?? undefined,
		htmlUrl: data.html_url,
		publishedAt: data.published_at ?? undefined
	};
}

// ─── Release-notes range (a dependency whose version changed in the diff) ────
// When a dep bumps `1.0.0 -> 1.1.0` we want every release in between, not just
// one. There's no range endpoint, so we list recent releases and filter by a
// hand-rolled semver compare (we don't ship a semver lib). The range is
// (lower, higher]: the releases you gain upgrading (or lose downgrading), which
// is the same set in either direction.

const RANGE_MAX = 20; // cap how many release sections we return

interface Semver {
	major: number;
	minor: number;
	patch: number;
	// Dot-separated prerelease identifiers (`1.1.0-beta.2` → ['beta','2']); empty
	// for a normal release, which sorts ABOVE any of its prereleases.
	pre: string[];
}

function parseSemver(version: string): Semver | null {
	const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/.exec(version.trim());
	if (!m) return null;
	return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

function compareSemver(a: Semver, b: Semver): number {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	if (a.patch !== b.patch) return a.patch - b.patch;
	if (a.pre.length === 0 && b.pre.length === 0) return 0;
	if (a.pre.length === 0) return 1; // release > prerelease
	if (b.pre.length === 0) return -1;
	const n = Math.max(a.pre.length, b.pre.length);
	for (let i = 0; i < n; i++) {
		const ai = a.pre[i];
		const bi = b.pre[i];
		if (ai === undefined) return -1; // shorter prerelease set sorts lower
		if (bi === undefined) return 1;
		const an = /^\d+$/.test(ai);
		const bn = /^\d+$/.test(bi);
		if (an && bn) {
			const d = +ai - +bi;
			if (d !== 0) return d;
		} else if (an)
			return -1; // numeric identifiers sort below alphanumeric
		else if (bn) return 1;
		else if (ai !== bi) return ai < bi ? -1 : 1;
	}
	return 0;
}

// Extract this package's version from a release tag. `preferNameAt` is set when
// the repo is known to use `name@1.2.3` tags (a monorepo publishing per package),
// so we ignore its shared `vX.Y.Z` tags that belong to other packages / the root.
function versionFromTag(tag: string, packageName: string, preferNameAt: boolean): string | null {
	if (tag.startsWith(`${packageName}@`)) return tag.slice(packageName.length + 1);
	if (preferNameAt) return null;
	if (/^v\d/.test(tag)) return tag.slice(1);
	if (/^\d/.test(tag)) return tag;
	return null;
}

interface ReleaseNotesRangeCacheEntry {
	at: number;
	result: ReleaseNotesRangeResult;
}
const releaseNotesRangeCache = new Map<string, ReleaseNotesRangeCacheEntry>();

export async function getReleaseNotesRange(
	repositoryUrl: string,
	packageName: string,
	fromVersion: string,
	toVersion: string
): Promise<ReleaseNotesRangeResult> {
	const parsed = parseGithubRepo(repositoryUrl);
	const from = parseSemver(fromVersion);
	const to = parseSemver(toVersion);
	if (!parsed || !from || !to) return { ok: true, releases: [], truncated: false };
	const cmp = compareSemver(from, to);
	if (cmp === 0) return { ok: true, releases: [], truncated: false };
	const lo = cmp < 0 ? from : to; // exclusive lower bound
	const hi = cmp < 0 ? to : from; // inclusive upper bound
	const { owner, repo } = parsed;

	const cacheKey = `${packageName}:${fromVersion}..${toVersion}`;
	const cached = releaseNotesRangeCache.get(cacheKey);
	if (cached && Date.now() - cached.at < RELEASE_NOTES_TTL_MS) return cached.result;

	const o = releaseNotesOctokit();
	try {
		// One page of the 100 most recent releases (newest first), enough for any
		// realistic bump. A jump that reaches past 100 releases is reported as
		// truncated so the card can point at the full changelog.
		const { data } = await o.repos.listReleases({ owner, repo, per_page: 100 });
		const usesNameAt = data.some((r) => r.tag_name.startsWith(`${packageName}@`));
		const inRange: { v: Semver; release: ReleaseNotes }[] = [];
		let reachedLo = false;
		for (const r of data) {
			if (r.draft) continue;
			const versionStr = versionFromTag(r.tag_name, packageName, usesNameAt);
			if (!versionStr) continue;
			const v = parseSemver(versionStr);
			if (!v) continue;
			if (compareSemver(v, lo) <= 0) {
				reachedLo = true; // walked past the lower bound; older releases are out
				continue;
			}
			if (compareSemver(v, hi) > 0) continue; // above the new version
			inRange.push({ v, release: mapRelease(r) });
		}
		inRange.sort((x, y) => compareSemver(y.v, x.v)); // newest first
		// Incomplete if a full page didn't reach the lower bound (older in-range
		// releases may exist beyond page 1), or if we hit the display cap.
		const incomplete = data.length >= 100 && !reachedLo;
		const releases = inRange.slice(0, RANGE_MAX).map((x) => x.release);
		const truncated = incomplete || inRange.length > RANGE_MAX;
		const result: ReleaseNotesRangeResult = { ok: true, releases, truncated };
		releaseNotesRangeCache.set(cacheKey, { at: Date.now(), result });
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Could not load release notes: ${message}` };
	}
}

// Bridge the signed-in GitHub OAuth token to git transport. git authenticates
// HTTPS remotes through the OS credential helper, independent of the app's
// sign-in, so a private repo otherwise fails with "Repository not found" even
// though our token has access. For github.com HTTPS remotes we hand git the
// active account's token as an `x-access-token` basic credential. Resolved per
// call so sign-in/out is picked up live, and so the token is never cached
// anywhere git could persist it. Call once after the app is ready.
export function registerGitCredentials(): void {
	setGitCredentialProvider((remoteUrl: string): GitCredentials | null => {
		let host: string;
		try {
			host = new URL(remoteUrl).hostname.toLowerCase();
		} catch {
			return null;
		}
		if (host !== 'github.com') return null;
		const account = getActiveGithubAccount();
		if (!account?.token) return null;
		return { username: 'x-access-token', password: account.token };
	});
}

// The author/committer identity for commits made under a given account. Uses
// GitHub's no-reply email format so commits are attributed to that account.
export function resolveCommitIdentity(accountId?: string | null): GitIdentity | null {
	const pinned = accountId ? getGithubAccount(accountId) : null;
	const account = pinned ?? getActiveGithubAccount();
	if (!account) return null;
	return {
		name: account.name ?? account.login,
		email: `${account.id}+${account.login}@users.noreply.github.com`
	};
}

// Resolve the SSH signing material for a commit made under a given account, or
// null to commit unsigned. Returns null when the user turned signing off, when
// the local git/ssh-keygen can't sign, when no account is linked, or when key
// provisioning fails — every one of which should degrade to an unsigned commit,
// never a blocked one. As a side effect it ensures the account's key exists and
// (best-effort, fire-and-forget) is registered with GitHub so commits verify.
export async function resolveCommitSigning(
	accountId?: string | null
): Promise<CommitSigning | null> {
	if (!getPrefs().signCommits) return null;
	if (!(await checkSshSigningSupported())) return null;
	const pinned = accountId ? getGithubAccount(accountId) : null;
	const account = pinned ?? getActiveGithubAccount();
	if (!account) return null;
	const keyPath = await ensureSigningKey(account.id, account.login);
	if (!keyPath) return null;
	// Register the public key with GitHub so the signature verifies there. Don't
	// await — a slow or failing API call must not delay (or block) the commit.
	void ensureSigningKeyRegistered(account);
	return { keyPath };
}

// Upload the account's SSH signing key to GitHub (idempotent) so commits signed
// with it show as "Verified". Best-effort: skipped once registered, skipped when
// the token lacks the scope (the user is prompted to re-auth separately), and
// swallows errors so it never affects committing. A 422 means the key is already
// registered, which we treat as success.
async function ensureSigningKeyRegistered(account: StoredGithubAccount): Promise<void> {
	if (account.signingKeyRegistered) return;
	if (!hasSigningScope(account)) return;
	const publicKey = await readSigningPublicKey(account.id);
	if (!publicKey) return;
	try {
		await octokit(account).request('POST /user/ssh_signing_keys', {
			title: `Super Review (${os.hostname()})`,
			key: publicKey
		});
		setSigningKeyRegistered(account.id);
	} catch (err) {
		if ((err as { status?: number }).status === 422) {
			// Already registered (e.g. a prior run, or the same key re-added).
			setSigningKeyRegistered(account.id);
			return;
		}
		// Any other failure: leave unregistered so a later commit retries.
	}
}

// Organizations the account can create repositories under, for the Publish
// Repository dialog's org dropdown. Best-effort: returns [] if the call fails.
export async function listOrganizations(accountId?: string | null): Promise<GithubOrg[]> {
	const o = octokit(resolveAccount(accountId));
	const res = await o.orgs.listForAuthenticatedUser({ per_page: 100 });
	return res.data.map((org) => ({ login: org.login, avatarUrl: org.avatar_url ?? undefined }));
}

// Create a new repository on GitHub — under an organization when `org` is set,
// otherwise the authenticated user's personal account. `auto_init: false` keeps
// the remote empty so we can push the existing local history into it.
export async function createRemoteRepo(opts: {
	name: string;
	description?: string;
	private: boolean;
	org?: string | null;
	accountId?: string | null;
}): Promise<{ cloneUrl: string; sshUrl: string; htmlUrl: string; owner: string }> {
	const account = resolveAccount(opts.accountId);
	const o = octokit(account);
	const params = {
		name: opts.name,
		description: opts.description,
		private: opts.private,
		auto_init: false
	};
	const shape = (d: {
		clone_url: string;
		ssh_url: string;
		html_url: string;
		owner: { login: string } | null;
	}) => ({
		cloneUrl: d.clone_url,
		sshUrl: d.ssh_url,
		htmlUrl: d.html_url,
		owner: d.owner?.login ?? ''
	});
	try {
		const res = opts.org
			? await o.repos.createInOrg({ org: opts.org, ...params })
			: await o.repos.createForAuthenticatedUser(params);
		return shape(res.data);
	} catch (err) {
		// Make publish retryable: if the repo already exists on the account/org
		// (e.g. a previous attempt created it but the push failed), reuse it
		// instead of erroring out. Any other failure propagates.
		const status = (err as { status?: number }).status;
		if (status !== 422) throw err;
		const owner = opts.org ?? account.login;
		const got = await o.repos.get({ owner, repo: opts.name });
		return shape(got.data);
	}
}

// Number of PRs fetched per page. The renderer pages through these as the
// user scrolls the Pull Requests list.
export const PR_PAGE_SIZE = 30;

// Map a raw Octokit pull-request object (from either pulls.list or pulls.get,
// which share these fields) into our PRSummary shape.
function toPRSummary(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pr: any
): PRSummary {
	return {
		number: pr.number,
		title: pr.title,
		body: pr.body ?? '',
		author: pr.user?.login ?? 'unknown',
		authorAvatarUrl: pr.user?.avatar_url ?? '',
		authorAssociation: pr.author_association ?? undefined,
		headRef: pr.head.ref,
		baseRef: pr.base.ref,
		headSha: pr.head.sha,
		baseSha: pr.base.sha,
		url: pr.html_url,
		draft: pr.draft ?? false,
		updatedAt: pr.updated_at,
		createdAt: pr.created_at,
		state: pr.state as 'open' | 'closed',
		merged: pr.merged_at != null,
		headRepoCloneUrl: pr.head.repo?.clone_url ?? undefined,
		headRepoOwner: pr.head.repo?.owner?.login ?? undefined,
		headRepoName: pr.head.repo?.name ?? undefined,
		maintainerCanModify: pr.maintainer_can_modify ?? undefined,
		repoOwner: pr.base.repo?.owner?.login ?? undefined,
		repoName: pr.base.repo?.name ?? undefined,
		// Present only on single-PR (pulls.get) responses — absent on list rows.
		// Keep null (GitHub still computing) distinct from undefined (not fetched).
		mergeable: pr.mergeable === undefined ? undefined : pr.mergeable,
		mergeableState: pr.mergeable_state ?? undefined
	};
}

// Whether the authenticated account can push commits to a PR's head branch:
// either it has push access to the head repo directly, or the PR allows
// maintainer edits and the account has push access to the base repo. Uses
// `repos.get`, which reports the viewer's own `permissions` on a repo. Returns
// null when the answer couldn't be determined (network failure, dead token) —
// only a definitive "no" from the API comes back as false, so a transient
// error never paints a "can't push" warning.
export async function canPushToPR(
	args: {
		headOwner?: string;
		headRepo?: string;
		baseOwner: string;
		baseRepo: string;
		prNumber: number;
		maintainerCanModify?: boolean;
	},
	accountId?: string | null
): Promise<boolean | null> {
	const o = octokit(resolveAccount(accountId));
	let definitive = true;
	// Direct push access to the repo the head branch lives in.
	if (args.headOwner && args.headRepo) {
		try {
			const head = await o.repos.get({
				owner: args.headOwner,
				repo: args.headRepo
			});
			if (head.data.permissions?.push) return true;
		} catch (err) {
			// 404 = no visibility into the head repo — a real "no" for this path;
			// fall through to the maintainer path. Anything else leaves the overall
			// answer unknown.
			if ((err as { status?: number }).status !== 404) definitive = false;
		}
	}
	// Maintainer edit: the PR opts in and we can push to the base repo.
	try {
		let canModify = args.maintainerCanModify;
		if (canModify === undefined) {
			const pr = await o.pulls.get({
				owner: args.baseOwner,
				repo: args.baseRepo,
				pull_number: args.prNumber
			});
			canModify = pr.data.maintainer_can_modify ?? false;
		}
		if (canModify) {
			const base = await o.repos.get({
				owner: args.baseOwner,
				repo: args.baseRepo
			});
			if (base.data.permissions?.push) return true;
		}
	} catch (err) {
		if ((err as { status?: number }).status !== 404) definitive = false;
	}
	return definitive ? false : null;
}

// List PRs for the repo, most-recently-updated first. `state: 'all'` so the
// list surfaces open, draft, closed and merged PRs (the renderer distinguishes
// them by their status icon). Paginated so the renderer can scroll infinitely.
export async function listPullRequests(
	owner: string,
	repo: string,
	accountId?: string | null,
	page = 1
): Promise<PRSummary[]> {
	const o = octokit(resolveAccount(accountId));
	const res = await o.pulls.list({
		owner,
		repo,
		state: 'all',
		sort: 'updated',
		direction: 'desc',
		per_page: PR_PAGE_SIZE,
		page
	});
	return res.data.map(toPRSummary);
}

// When `owner/repo` is a fork, return its parent ("upstream") repo's
// owner/name; null otherwise (not a fork, or the lookup failed). The GitHub
// API reports this via the `parent` field, so it works even when the user
// never configured an `upstream` git remote.
export async function getUpstream(
	owner: string,
	repo: string,
	accountId?: string | null
): Promise<{ owner: string; repo: string } | null> {
	const o = octokit(resolveAccount(accountId));
	try {
		const res = await o.repos.get({ owner, repo });
		const parent = res.data.parent;
		if (res.data.fork && parent?.owner?.login && parent.name) {
			return { owner: parent.owner.login, repo: parent.name };
		}
		return null;
	} catch {
		return null;
	}
}

// Whether the authenticated account can push to `owner/repo` itself. `repos.get`
// reports the viewer's own `permissions` on the repo. Only a definitive "no" —
// the API answered and the account lacks push (or any visibility: 404) — comes
// back as false, which is what lets the UI offer to fork. Every other failure
// (network, rate limit, dead token) returns null so a transient error is never
// presented as missing write access.
export async function canPushToRepo(
	owner: string,
	repo: string,
	accountId?: string | null
): Promise<boolean | null> {
	const o = octokit(resolveAccount(accountId));
	try {
		const res = await o.repos.get({ owner, repo });
		return res.data.permissions?.push === true;
	} catch (err) {
		return (err as { status?: number }).status === 404 ? false : null;
	}
}

// Fork `owner/repo` under the authenticated account and return the fork's
// owner/name. Fork creation is asynchronous (the API responds 202 before the
// fork's git data is ready), so we poll `repos.get` on the new fork until it
// resolves before handing back — otherwise an immediate push would race the
// repo's creation.
export async function createFork(
	owner: string,
	repo: string,
	accountId?: string | null
): Promise<{ owner: string; repo: string }> {
	const o = octokit(resolveAccount(accountId));
	const res = await o.repos.createFork({ owner, repo });
	const fork = { owner: res.data.owner?.login ?? '', repo: res.data.name };
	if (!fork.owner) throw new Error('Fork created but its owner could not be resolved.');
	// Poll until the fork is queryable (≈ exists on disk). Best-effort: give up
	// after ~10s and let the caller's push surface any not-ready error.
	for (let i = 0; i < 10; i++) {
		try {
			await o.repos.get({ owner: fork.owner, repo: fork.repo });
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
	return fork;
}

export async function getPRBase(
	owner: string,
	repo: string,
	prNumber: number,
	accountId?: string | null
): Promise<{ baseRef: string; headRef: string }> {
	const o = octokit(resolveAccount(accountId));
	const res = await o.pulls.get({ owner, repo, pull_number: prNumber });
	return { baseRef: res.data.base.ref, headRef: res.data.head.ref };
}

export async function getPRSummary(
	owner: string,
	repo: string,
	prNumber: number,
	accountId?: string | null
): Promise<PRSummary | null> {
	const o = octokit(resolveAccount(accountId));
	try {
		const res = await o.pulls.get({ owner, repo, pull_number: prNumber });
		return toPRSummary(res.data);
	} catch {
		return null;
	}
}

// Map a single check-run's status/conclusion to our tri-state.
function checkRunState(
	status: string,
	conclusion: string | null
): 'success' | 'failure' | 'pending' {
	if (status !== 'completed') return 'pending';
	switch (conclusion) {
		case 'failure':
		case 'cancelled':
		case 'timed_out':
		case 'action_required':
			return 'failure';
		default:
			// success, neutral, skipped — treat as not-blocking.
			return 'success';
	}
}

// Roll a list of per-check states into the aggregate, matching GitHub's
// combined-status precedence: any failure wins, then anything still running,
// else success.
function rollupChecks(checks: PRCheck[]): PRChecksState {
	if (checks.length === 0) return 'none';
	if (checks.some((c) => c.state === 'failure')) return 'failure';
	if (checks.some((c) => c.state === 'pending')) return 'pending';
	return 'success';
}

// Map a GraphQL DeploymentStatusState onto our check vocabulary so the menu can
// reuse the same status icons. Returns null for inactive/abandoned states with
// no meaningful indicator.
function deploymentState(s: string | null | undefined): PRChecksState | null {
	switch (s) {
		case 'ACTIVE':
		case 'SUCCESS':
			return 'success';
		case 'ERROR':
		case 'FAILURE':
			return 'failure';
		case 'IN_PROGRESS':
		case 'QUEUED':
		case 'PENDING':
		case 'WAITING':
			return 'pending';
		default:
			return null;
	}
}

// Deployments created against the head commit (preview/production environments),
// fetched via GraphQL so we get the live environment URL in one request. Deduped
// to the latest deployment per environment, keeping only those with a URL to
// view. `ref` must be the head SHA (the only thing getChecks is called with).
async function getDeployments(
	o: Octokit,
	owner: string,
	repo: string,
	ref: string
): Promise<PRDeployment[]> {
	const query = `
    query ($owner: String!, $repo: String!, $oid: GitObjectID!) {
      repository(owner: $owner, name: $repo) {
        object(oid: $oid) {
          ... on Commit {
            deployments(first: 50, orderBy: { field: CREATED_AT, direction: DESC }) {
              nodes {
                environment
                creator { avatarUrl }
                latestStatus { state environmentUrl logUrl }
              }
            }
          }
        }
      }
    }`;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const res: any = await o.graphql(query, { owner, repo, oid: ref });
	const nodes: Array<{
		environment: string | null;
		creator: { avatarUrl: string | null } | null;
		latestStatus: {
			state: string | null;
			environmentUrl: string | null;
			logUrl: string | null;
		} | null;
	}> = res?.repository?.object?.deployments?.nodes ?? [];

	const byEnv = new Map<string, PRDeployment>();
	for (const n of nodes) {
		const env = n.environment ?? 'deployment';
		// Nodes are newest-first, so the first one seen per environment is latest.
		if (byEnv.has(env)) continue;
		// Prefer the live environment URL, fall back to the deploy log. Without a
		// URL there's nothing to view, so skip it.
		const url = n.latestStatus?.environmentUrl || n.latestStatus?.logUrl;
		if (!url) continue;
		byEnv.set(env, {
			environment: env,
			state: deploymentState(n.latestStatus?.state),
			url,
			// The creating app's avatar is the hosting provider's logo.
			avatarUrl: n.creator?.avatarUrl ?? null
		});
	}
	return [...byEnv.values()];
}

// Aggregate GitHub Actions check-runs and legacy commit statuses for a ref,
// returning both the rolled-up state and the individual checks (name, state,
// run time) for a hover breakdown, plus any deployments attached to the commit.
// `state` is 'none' when nothing reports.
export async function getChecks(
	owner: string,
	repo: string,
	ref: string,
	accountId?: string | null
): Promise<PRChecksSummary> {
	const o = octokit(resolveAccount(accountId));
	const [runs, combined, deployments] = await Promise.all([
		o.checks.listForRef({ owner, repo, ref, per_page: 100 }),
		o.repos.getCombinedStatusForRef({ owner, repo, ref }).catch(() => null),
		// Deployments are best-effort; a failure here must not sink the checks.
		getDeployments(o, owner, repo, ref).catch(() => [])
	]);

	const checks: PRCheck[] = [];

	for (const run of runs.data.check_runs) {
		const started = run.started_at ? Date.parse(run.started_at) : NaN;
		const completed = run.completed_at ? Date.parse(run.completed_at) : NaN;
		const durationMs =
			Number.isFinite(started) && Number.isFinite(completed)
				? Math.max(0, completed - started)
				: null;
		checks.push({
			name: run.name,
			state: checkRunState(run.status, run.conclusion),
			durationMs,
			avatarUrl: run.app?.owner?.avatar_url ?? null,
			// `details_url` is the specific job/run page (what GitHub links the row
			// to); `html_url` is the check-run itself. Prefer the former.
			url: run.details_url ?? run.html_url ?? null
		});
	}

	// Legacy commit statuses (e.g. older CI integrations) don't surface timing,
	// so they show up without a duration.
	if (combined) {
		for (const s of combined.data.statuses) {
			const state: PRChecksState =
				s.state === 'success' ? 'success' : s.state === 'pending' ? 'pending' : 'failure';
			checks.push({
				name: s.context,
				state,
				durationMs: null,
				avatarUrl: s.avatar_url ?? null,
				url: s.target_url ?? null
			});
		}
	}

	return { state: rollupChecks(checks), checks, deployments };
}

function mapReviewComment(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	c: any,
	prNumber: number,
	viewerLogin: string | null
): PRReviewComment {
	return {
		id: c.id,
		prNumber,
		path: c.path,
		body: c.body ?? '',
		bodyHtml: c.body_html ?? undefined,
		author: c.user?.login ?? 'unknown',
		authorAvatarUrl: c.user?.avatar_url ?? '',
		createdAt: c.created_at,
		updatedAt: c.updated_at,
		url: c.html_url,
		// `line` is the live anchor (null when outdated); `original_line` is kept
		// separately so we can still render/label an outdated comment. We no longer
		// fall back from one to the other — conflating them would pin an outdated
		// comment onto the wrong current-diff line.
		line: c.line ?? null,
		originalLine: c.original_line ?? null,
		position: c.position ?? null,
		diffHunk: c.diff_hunk ?? undefined,
		// Outdated = the comment had a line anchor (`original_line`) that no longer
		// maps into the current diff, so GitHub nulls the live `line`. We key off
		// `line` rather than `position`: REST keeps `position` populated (it reflects
		// the original diff position) even for outdated comments, whereas `line` goes
		// null — matching GitHub's GraphQL `outdated` flag. Requiring `original_line`
		// excludes genuine file-level comments (no line anchor at all).
		isOutdated: c.line == null && c.original_line != null,
		side: (c.side ?? 'RIGHT') as 'LEFT' | 'RIGHT',
		inReplyTo: c.in_reply_to_id ?? undefined,
		canDelete: viewerLogin ? c.user?.login === viewerLogin : false,
		// Thread info lives in GraphQL, not the REST payload — defaulted here and
		// stamped on by listReviewComments. Newly created/replied comments keep
		// these defaults until the next refresh refetches the threads.
		threadId: undefined,
		isResolved: false
	};
}

// Resolution state lives only in GraphQL (`reviewThreads`), so we fetch the
// PR's threads and build a databaseId → { threadId, isResolved } map. The REST
// comment `id` equals the GraphQL `databaseId`, which lets us stamp thread info
// onto the REST comments. Paginated over threads (their comment lists rarely
// exceed the first 100, which is all we need to map ids back to a thread).
async function fetchThreadInfoByCommentId(
	o: Octokit,
	owner: string,
	repo: string,
	prNumber: number
): Promise<Map<number, { threadId: string; isResolved: boolean }>> {
	const query = `
    query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isResolved
              comments(first: 100) {
                nodes { databaseId }
              }
            }
          }
        }
      }
    }`;

	const map = new Map<number, { threadId: string; isResolved: boolean }>();
	let cursor: string | null = null;
	for (;;) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res: any = await o.graphql(query, {
			owner,
			repo,
			number: prNumber,
			cursor
		});
		const threads = res?.repository?.pullRequest?.reviewThreads;
		if (!threads) break;
		for (const t of threads.nodes ?? []) {
			for (const c of t.comments?.nodes ?? []) {
				if (c?.databaseId != null) {
					map.set(c.databaseId, { threadId: t.id, isResolved: t.isResolved });
				}
			}
		}
		if (!threads.pageInfo?.hasNextPage) break;
		cursor = threads.pageInfo.endCursor;
	}
	return map;
}

export async function listReviewComments(
	owner: string,
	repo: string,
	prNumber: number,
	accountId?: string | null
): Promise<PRReviewComment[]> {
	const viewer = resolveAccount(accountId);
	const o = octokit(viewer);
	const all = await o.paginate(o.pulls.listReviewComments, {
		owner,
		repo,
		pull_number: prNumber,
		per_page: 100
	});
	// Thread resolution is GraphQL-only. Best-effort: if it fails (scope, GHE
	// without GraphQL, transient error) we still return the comments, just
	// without resolved markers rather than failing the whole list.
	let threadInfo: Map<number, { threadId: string; isResolved: boolean }>;
	try {
		threadInfo = await fetchThreadInfoByCommentId(o, owner, repo, prNumber);
	} catch (err) {
		console.error(
			`[github] fetchReviewThreads failed for ${owner}/${repo}#${prNumber}:`,
			err instanceof Error ? err.message : err
		);
		threadInfo = new Map();
	}
	return all.map((c) => {
		const mapped = mapReviewComment(c, prNumber, viewer?.login ?? null);
		const info = threadInfo.get(mapped.id);
		if (info) {
			mapped.threadId = info.threadId;
			mapped.isResolved = info.isResolved;
		}
		return mapped;
	});
}

// Resolve or unresolve a review thread via GraphQL (the REST API has no
// equivalent). Returns the thread's resolved state as GitHub reports it back.
export async function setReviewThreadResolved(
	threadId: string,
	resolved: boolean,
	accountId?: string | null
): Promise<{ isResolved: boolean }> {
	const o = octokit(resolveAccount(accountId));
	const mutation = resolved
		? `mutation ($threadId: ID!) {
         resolveReviewThread(input: { threadId: $threadId }) {
           thread { id isResolved }
         }
       }`
		: `mutation ($threadId: ID!) {
         unresolveReviewThread(input: { threadId: $threadId }) {
           thread { id isResolved }
         }
       }`;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const res: any = await o.graphql(mutation, { threadId });
	const thread = resolved ? res?.resolveReviewThread?.thread : res?.unresolveReviewThread?.thread;
	return { isResolved: thread?.isResolved ?? resolved };
}

export async function createReviewComment(
	owner: string,
	repo: string,
	input: NewReviewCommentInput,
	accountId?: string | null,
	// SHA of the commit the on-screen diff was rendered from — `pr/<n>/head` for a
	// PR view, or the branch tip for a Branch view. Anchoring the comment here —
	// rather than the PR's live head — guarantees the line/side the user clicked
	// resolve against the same diff they're looking at. On the Branch tab the
	// branch tip (once pushed) is itself the PR's live head, so the comment isn't
	// born "Outdated". Falls back to the live head when this can't be resolved.
	commitId?: string | null
): Promise<PRReviewComment> {
	const viewer = resolveAccount(accountId);
	const o = octokit(viewer);
	// Anchor to the reviewed snapshot; fetch the live head only as a fallback.
	const anchor =
		commitId ?? (await o.pulls.get({ owner, repo, pull_number: input.prNumber })).data.head.sha;
	try {
		const res = await o.pulls.createReviewComment({
			owner,
			repo,
			pull_number: input.prNumber,
			body: input.body,
			commit_id: anchor,
			path: input.path,
			line: input.line,
			side: input.side
		});
		return mapReviewComment(res.data, input.prNumber, viewer?.login ?? null);
	} catch (err) {
		// GitHub rejects a comment whose (path, line, side) it can't place in the
		// PR's diff at the anchored commit with a 422 "could not be resolved". It
		// reports the unresolvable anchor on either the `.path` or the `.line`
		// field of `pull_request_review_thread` (the `.line` variant is what you
		// get when the path matches but the specific line doesn't). A third case:
		// when we anchor to a Branch view's tip that hasn't been pushed yet, GitHub
		// doesn't know that commit and rejects it on the `.commit_id` field. All
		// mean the same thing: the on-screen diff disagrees with the PR's diff at
		// its head — the PR was rebased/force-pushed since it loaded, or (in the
		// Branch tab) the local branch has changes that aren't pushed to the PR
		// yet. Surface something actionable instead of the raw API validation JSON.
		const status = (err as { status?: number }).status;
		const errors = (
			err as { response?: { data?: { errors?: Array<{ field?: string; code?: string }> } } }
		).response?.data?.errors;
		const unresolvableAnchor = errors?.some(
			(e) =>
				e.field?.endsWith('.path') || e.field?.endsWith('.line') || e.field?.endsWith('.commit_id')
		);
		if (status === 422 && unresolvableAnchor) {
			throw new Error(
				`GitHub couldn't place this comment on ${input.path}:${input.line} — that line isn't ` +
					`part of the PR's current diff. Either the PR was updated since you opened it, or ` +
					`your local branch has changes that haven't been pushed to the PR yet. Refresh the ` +
					`PR (or push your branch) and try again.`,
				{ cause: err }
			);
		}
		throw err;
	}
}

export async function replyReviewComment(
	owner: string,
	repo: string,
	prNumber: number,
	commentId: number,
	body: string,
	accountId?: string | null
): Promise<PRReviewComment> {
	const viewer = resolveAccount(accountId);
	const o = octokit(viewer);
	const res = await o.pulls.createReplyForReviewComment({
		owner,
		repo,
		pull_number: prNumber,
		comment_id: commentId,
		body
	});
	return mapReviewComment(res.data, prNumber, viewer?.login ?? null);
}

export async function deleteReviewComment(
	owner: string,
	repo: string,
	commentId: number,
	accountId?: string | null
): Promise<void> {
	const o = octokit(resolveAccount(accountId));
	await o.pulls.deleteReviewComment({ owner, repo, comment_id: commentId });
}

// Returns the open PR for `branch`, or null. PRs are listed on `baseOwner/baseRepo`
// (where the PR lives — the upstream parent for a fork contributing to it) and
// filtered by the head `${headOwner}:${branch}`, where `headOwner` owns the branch
// (the fork for a cross-repo PR). For a non-fork these are the same repo/owner.
// `branch` is the local branch name — same as headRef.
export async function findPRForBranch(
	baseOwner: string,
	baseRepo: string,
	headOwner: string,
	branch: string,
	accountId?: string | null
): Promise<PRSummary | null> {
	const account = resolveAccount(accountId);
	console.log(
		`[github] findPRForBranch base=${baseOwner}/${baseRepo} head=${headOwner}:${branch} ` +
			`requestedAccountId=${accountId ?? '(none → app default)'} ` +
			`usingAccount=${account.login} (id=${account.id})`
	);
	const o = octokit(account);
	const res = await o.pulls.list({
		owner: baseOwner,
		repo: baseRepo,
		state: 'open',
		head: `${headOwner}:${branch}`,
		per_page: 1
	});
	console.log(
		`[github] findPRForBranch head=${headOwner}:${branch} → ${res.data.length} match(es)` +
			(res.data[0] ? ` (PR #${res.data[0].number})` : '')
	);
	const pr = res.data[0];
	if (!pr) return null;
	return toPRSummary(pr);
}

// ─── PR conversation timeline ────────────────────────────────────────────────
// The "Conversation" tab feed: the PR's top-level discussion — issue comments,
// submitted reviews, commits, and lighter timeline events (merged, labeled, …) —
// flattened into one chronologically-ordered list. We read GitHub's unified
// issue-timeline endpoint, which already interleaves these in order, and map the
// handful of event kinds we render. Unknown events are dropped so the feed stays
// signal over noise. Line-anchored review comments are deliberately excluded —
// those belong to the Comments tab (`listReviewComments`).

// Review-event states GitHub reports, lower-cased. 'pending' (an unsubmitted
// draft review) never appears on the timeline, so it isn't in our union.
function reviewState(state: unknown): PRConversationReview['state'] | null {
	switch (String(state).toLowerCase()) {
		case 'approved':
			return 'approved';
		case 'changes_requested':
			return 'changes_requested';
		case 'commented':
			return 'commented';
		case 'dismissed':
			return 'dismissed';
		default:
			return null;
	}
}

// Map a single raw timeline event to a conversation item, or null to drop it
// (unknown event, or a contentless one we don't surface). `viewerLogin` decides
// delete permission on the viewer's own comments.
function mapTimelineItem(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	e: any,
	viewerLogin: string | null
): PRConversationItem | null {
	switch (e.event) {
		case 'commented': {
			const author = e.user?.login ?? 'unknown';
			return {
				kind: 'comment',
				key: `comment-${e.id}`,
				id: e.id,
				author,
				authorAvatarUrl: e.user?.avatar_url ?? '',
				authorAssociation: e.author_association ?? undefined,
				body: e.body ?? '',
				url: e.html_url ?? '',
				createdAt: e.created_at,
				canDelete: viewerLogin ? author === viewerLogin : false
			};
		}
		case 'reviewed': {
			const state = reviewState(e.state);
			if (!state) return null;
			// A bare "commented" review with no summary body is just the wrapper around
			// inline comments (shown on the Comments tab) — drop it so the feed isn't
			// littered with empty review rows. Approvals / change-requests are kept even
			// without a body since their verdict is the content.
			if (state === 'commented' && !(e.body ?? '').trim()) return null;
			return {
				kind: 'review',
				key: `review-${e.id}`,
				id: e.id,
				author: e.user?.login ?? 'unknown',
				authorAvatarUrl: e.user?.avatar_url ?? '',
				authorAssociation: e.author_association ?? undefined,
				body: e.body ?? '',
				state,
				url: e.html_url ?? '',
				createdAt: e.submitted_at ?? e.created_at
			};
		}
		case 'committed': {
			// `committed` events carry the git identity (name/date), not a GitHub user,
			// so there's no reliable avatar. The SHA is GitHub's `sha`; `verification`
			// mirrors the commit-signing state GitHub shows as a "Verified" badge.
			const sha: string = e.sha ?? '';
			const lines: string[] = (e.message ?? '').split('\n');
			const message = lines[0] ?? '';
			const body = lines.slice(1).join('\n').trim();
			return {
				kind: 'commit',
				key: `commit-${sha}`,
				sha,
				shortSha: sha.slice(0, 7),
				message,
				body: body || undefined,
				author: e.author?.name ?? e.committer?.name ?? 'unknown',
				verified: e.verification?.verified === true,
				url: e.html_url ?? undefined,
				createdAt: e.author?.date ?? e.committer?.date ?? ''
			};
		}
		// Lighter activity events rendered as a one-line entry. Anything not listed
		// here falls through to `null` and is dropped.
		case 'merged':
		case 'closed':
		case 'reopened':
		case 'locked':
		case 'unlocked':
		case 'head_ref_force_pushed':
		case 'head_ref_deleted':
		case 'head_ref_restored':
		case 'convert_to_draft':
		case 'ready_for_review':
		case 'labeled':
		case 'unlabeled':
		case 'renamed':
		case 'review_requested':
		case 'review_request_removed':
		case 'assigned':
		case 'unassigned': {
			let detail: string | undefined;
			let labelColor: string | undefined;
			let renamedFrom: string | undefined;
			if (e.event === 'labeled' || e.event === 'unlabeled') {
				detail = e.label?.name;
				labelColor = e.label?.color ?? undefined;
			} else if (e.event === 'renamed') {
				detail = e.rename?.to;
				renamedFrom = e.rename?.from;
			} else if (e.event === 'review_requested' || e.event === 'review_request_removed')
				detail = e.requested_reviewer?.login ?? e.requested_team?.name;
			else if (e.event === 'assigned' || e.event === 'unassigned') detail = e.assignee?.login;
			return {
				kind: 'event',
				key: `event-${e.id ?? `${e.event}-${e.created_at}`}`,
				event: e.event,
				actor: e.actor?.login ?? 'unknown',
				actorAvatarUrl: e.actor?.avatar_url ?? undefined,
				detail,
				renamedFrom,
				labelColor,
				// The merge commit's short SHA, surfaced so the row reads "merged commit
				// <sha> into <base>". `commitUrl` is filled in by the caller, which has
				// the repo coordinates.
				commitSha:
					e.event === 'merged' && typeof e.commit_id === 'string'
						? e.commit_id.slice(0, 7)
						: undefined,
				createdAt: e.created_at
			};
		}
		// Another issue/PR referenced this one ("X mentioned this pull request").
		case 'cross-referenced': {
			const src = e.source?.issue;
			if (!src || typeof src.number !== 'number') return null;
			const isPullRequest = !!src.pull_request;
			let refState: PRConversationReference['refState'];
			if (isPullRequest && src.pull_request?.merged_at) refState = 'merged';
			else if (src.draft) refState = 'draft';
			else refState = src.state === 'closed' ? 'closed' : 'open';
			return {
				kind: 'reference',
				key: `xref-${src.id ?? src.number}-${e.created_at}`,
				actor: e.actor?.login ?? src.user?.login ?? 'unknown',
				actorAvatarUrl: e.actor?.avatar_url ?? undefined,
				refNumber: src.number,
				refTitle: src.title ?? '',
				refUrl: src.html_url ?? '',
				isPullRequest,
				refState,
				createdAt: e.created_at
			};
		}
		default:
			return null;
	}
}

export async function listConversation(
	owner: string,
	repo: string,
	prNumber: number,
	accountId?: string | null
): Promise<PRConversationItem[]> {
	const viewer = resolveAccount(accountId);
	const o = octokit(viewer);
	// The PR's issue number equals its PR number; the timeline lives on the issue.
	// In parallel, list the PR's commits — the timeline's `committed` events carry
	// only a git identity (no GitHub user), so we map each SHA to its author's
	// avatar here to render the same avatars GitHub shows. Best-effort: a failed
	// commit listing just leaves commits without avatars. We also fetch the PR
	// itself for its `created_at`, used below to flag auto-requested Copilot
	// reviews; a failed fetch just disables that flag.
	const [events, commits, prCreatedAt] = await Promise.all([
		o.paginate(o.issues.listEventsForTimeline, {
			owner,
			repo,
			issue_number: prNumber,
			per_page: 100
		}),
		o
			.paginate(o.pulls.listCommits, { owner, repo, pull_number: prNumber, per_page: 100 })
			.catch(() => [] as Array<{ sha: string; author: unknown; committer: unknown }>),
		o.pulls
			.get({ owner, repo, pull_number: prNumber })
			.then((r) => r.data.created_at)
			.catch(() => null)
	]);
	const commitAvatars = new Map<string, string>();
	for (const c of commits) {
		const avatar =
			(c.author as { avatar_url?: string } | null)?.avatar_url ??
			(c.committer as { avatar_url?: string } | null)?.avatar_url;
		if (avatar) commitAvatars.set(c.sha, avatar);
	}

	// GitHub's "automatically request Copilot review" setting fires a
	// `review_requested` for Copilot right after the PR opens or is marked
	// ready-for-review — within a second or two, by the same actor. No API field
	// distinguishes it from a manual request (REST, GraphQL and
	// `performed_via_github_app` are all identical), so we infer it from that
	// timing: a Copilot request landing within the window after a "ready" moment.
	const AUTO_REVIEW_WINDOW_MS = 30_000;
	const readyTimes: number[] = [];
	if (prCreatedAt) readyTimes.push(Date.parse(prCreatedAt));
	for (const e of events as Array<{ event?: string; created_at?: string }>) {
		if (e.event === 'ready_for_review' && e.created_at) readyTimes.push(Date.parse(e.created_at));
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const isAutoCopilotRequest = (e: any): boolean => {
		if (e.event !== 'review_requested') return false;
		const r = e.requested_reviewer;
		if (!r || r.type !== 'Bot' || r.login !== 'Copilot') return false;
		const t = e.created_at ? Date.parse(e.created_at) : NaN;
		if (Number.isNaN(t)) return false;
		return readyTimes.some((rt) => t >= rt && t - rt <= AUTO_REVIEW_WINDOW_MS);
	};

	const items: PRConversationItem[] = [];
	for (const e of events) {
		const mapped = mapTimelineItem(e, viewer?.login ?? null);
		if (!mapped) continue;
		if (mapped.kind === 'commit') {
			mapped.authorAvatarUrl = commitAvatars.get(mapped.sha) ?? mapped.authorAvatarUrl;
		}
		// Re-attribute an auto-requested Copilot review to the reviewer, mirroring
		// GitHub: it shows "Copilot review requested due to automatic review
		// settings" rather than crediting the user who tripped the setting.
		if (mapped.kind === 'event' && isAutoCopilotRequest(e)) {
			const reviewer = (e as { requested_reviewer?: { login: string; avatar_url?: string } })
				.requested_reviewer;
			mapped.auto = true;
			if (reviewer) {
				mapped.actor = reviewer.login;
				mapped.actorAvatarUrl = reviewer.avatar_url ?? mapped.actorAvatarUrl;
			}
		}
		// Link the merge commit to its page on GitHub (the timeline gives only the
		// API url, so build the html one from the repo coordinates + SHA).
		if (
			mapped.kind === 'event' &&
			mapped.event === 'merged' &&
			typeof (e as { commit_id?: string }).commit_id === 'string'
		) {
			mapped.commitUrl = `https://github.com/${owner}/${repo}/commit/${(e as { commit_id: string }).commit_id}`;
		}
		items.push(mapped);
	}
	// GitHub emits both a `merged` and a `closed` event when a PR is merged; the two
	// say the same thing, so collapse to just the richer `merged` row (which carries
	// the commit + base). A plain-closed PR keeps its `closed` event.
	const merged = items.some((i) => i.kind === 'event' && i.event === 'merged');
	const deduped = merged
		? items.filter((i) => !(i.kind === 'event' && i.event === 'closed'))
		: items;
	// The timeline is roughly chronological already, but mixing `created_at`,
	// `submitted_at` and commit dates can interleave slightly out of order — sort
	// to be safe. Items with no usable timestamp sink to the bottom.
	deduped.sort((a, b) => {
		const at = a.createdAt ? Date.parse(a.createdAt) : Infinity;
		const bt = b.createdAt ? Date.parse(b.createdAt) : Infinity;
		return at - bt;
	});
	return deduped;
}

// Open a feedback issue on the project's own repo (FEEDBACK_REPO), tagged
// `in-app-feedback` so a triage workflow can pick it up. Authed with the active
// account — the renderer can't pass arbitrary coordinates, and the app/system
// metadata is appended here so it's trustworthy. Throws if not signed in.
export async function createFeedbackIssue(
	input: FeedbackInput,
	meta: { appVersion: string; platform: string; osRelease: string }
): Promise<FeedbackResult> {
	const viewer = resolveAccount(null);
	const o = octokit(viewer);
	const categoryLabel = FEEDBACK_CATEGORY_LABELS[input.category];
	const title = `[${categoryLabel}] ${input.title.trim()}`;
	const body = [
		input.body.trim(),
		'',
		'---',
		`- **Category:** ${categoryLabel}`,
		`- **App version:** ${meta.appVersion}`,
		`- **Platform:** ${meta.platform} (${meta.osRelease})`,
		`- **Reported by:** @${viewer.login}`,
		'',
		'_Filed from the in-app feedback dialog._'
	].join('\n');
	const res = await o.issues.create({
		owner: FEEDBACK_REPO.owner,
		repo: FEEDBACK_REPO.repo,
		title,
		body,
		labels: [FEEDBACK_LABEL]
	});
	return { url: res.data.html_url, number: res.data.number };
}

export async function createIssueComment(
	owner: string,
	repo: string,
	prNumber: number,
	body: string,
	accountId?: string | null
): Promise<PRConversationItem> {
	const viewer = resolveAccount(accountId);
	const o = octokit(viewer);
	const res = await o.issues.createComment({
		owner,
		repo,
		issue_number: prNumber,
		body
	});
	const c = res.data;
	return {
		kind: 'comment',
		key: `comment-${c.id}`,
		id: c.id,
		author: c.user?.login ?? viewer.login,
		authorAvatarUrl: c.user?.avatar_url ?? '',
		body: c.body ?? body,
		url: c.html_url ?? '',
		createdAt: c.created_at,
		canDelete: true
	};
}

export async function deleteIssueComment(
	owner: string,
	repo: string,
	commentId: number,
	accountId?: string | null
): Promise<void> {
	const o = octokit(resolveAccount(accountId));
	await o.issues.deleteComment({ owner, repo, comment_id: commentId });
}

// Edit a conversation comment's body (the user editing their own comment, or a
// task-list checkbox toggle rewriting the markdown). Returns the new body as
// GitHub stored it.
export async function updateIssueComment(
	owner: string,
	repo: string,
	commentId: number,
	body: string,
	accountId?: string | null
): Promise<string> {
	const o = octokit(resolveAccount(accountId));
	const res = await o.issues.updateComment({ owner, repo, comment_id: commentId, body });
	return res.data.body ?? body;
}

// Edit the PR's description (its body) — used by the Conversation tab's
// description card edit and its task-list checkbox toggles. Returns the new body.
export async function updatePullRequestBody(
	owner: string,
	repo: string,
	prNumber: number,
	body: string,
	accountId?: string | null
): Promise<string> {
	const o = octokit(resolveAccount(accountId));
	const res = await o.pulls.update({ owner, repo, pull_number: prNumber, body });
	return res.data.body ?? body;
}

// Merge a PR with the given method. GitHub returns `merged: false` (rather than
// throwing) when it declines a mergeable-looking PR, so the caller surfaces
// `message` instead of treating it as a hard error.
export async function mergePullRequest(
	owner: string,
	repo: string,
	prNumber: number,
	method: PRMergeMethod,
	accountId?: string | null,
	// Commit title/message for the merge commit (squash/merge methods only; rebase
	// ignores them). Undefined lets GitHub fall back to its own defaults.
	commitTitle?: string,
	commitMessage?: string
): Promise<PRMergeResult> {
	const o = octokit(resolveAccount(accountId));
	const res = await o.pulls.merge({
		owner,
		repo,
		pull_number: prNumber,
		merge_method: method,
		...(commitTitle ? { commit_title: commitTitle } : {}),
		...(commitMessage != null ? { commit_message: commitMessage } : {})
	});
	return { merged: res.data.merged, message: res.data.message, sha: res.data.sha };
}

// Take a draft PR out of draft. REST has no "undraft" endpoint, so we use the
// GraphQL markPullRequestReadyForReview mutation, which keys off the PR's global
// node id — fetched here since our PRSummary doesn't carry it.
export async function markPullRequestReady(
	owner: string,
	repo: string,
	prNumber: number,
	accountId?: string | null
): Promise<void> {
	const o = octokit(resolveAccount(accountId));
	const { data } = await o.pulls.get({ owner, repo, pull_number: prNumber });
	await o.graphql(
		`mutation ($id: ID!) {
       markPullRequestReadyForReview(input: { pullRequestId: $id }) {
         pullRequest { id isDraft }
       }
     }`,
		{ id: data.node_id }
	);
}
