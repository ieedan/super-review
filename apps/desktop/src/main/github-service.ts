import { Octokit } from '@octokit/rest';
import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import { shell } from 'electron';
import type {
	DeviceFlowStart,
	DeviceFlowStatus,
	GitIdentity,
	GithubAccount,
	GithubAuthError,
	GithubOrg,
	NewReviewCommentInput,
	PRCheck,
	PRChecksState,
	PRChecksSummary,
	PRDeployment,
	PRReviewComment,
	PRSummary
} from '@shared/types.js';
import { setGitCredentialProvider, type GitCredentials } from '@super-review/core';
import {
	clearLegacyGithubToken,
	getActiveGithubAccount,
	getGithubAccount,
	getLegacyGithubToken,
	listGithubAccounts,
	removeGithubAccount as storeRemoveAccount,
	setActiveGithubAccountId,
	upsertGithubAccount,
	type StoredGithubAccount
} from './store.js';

// Default GitHub OAuth client ID for "GitHub CLI" - public, ships with `gh`.
// Users can override via env var for self-hosted GHE later.
const CLIENT_ID = process.env.SUPER_REVIEW_GH_CLIENT_ID ?? '178c6fc778ccc68e1d6a';
const SCOPES = ['repo', 'read:user'];

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
	return {
		id: String(u.id),
		login: u.login,
		name: u.name ?? undefined,
		avatarUrl: u.avatar_url ?? undefined,
		addedAt: Date.now(),
		token
	};
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
			// Re-signing in mints a fresh token for the same account id — clear any
			// auth-failure flag so the renderer's prompt goes away.
			noteRequestSucceeded(account.id);
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
	if (authErrors.delete(accountId)) authErrorsListener?.(getAuthErrors());
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
		headRef: pr.head.ref,
		baseRef: pr.base.ref,
		headSha: pr.head.sha,
		baseSha: pr.base.sha,
		url: pr.html_url,
		draft: pr.draft ?? false,
		updatedAt: pr.updated_at,
		state: pr.state as 'open' | 'closed',
		merged: pr.merged_at != null,
		headRepoCloneUrl: pr.head.repo?.clone_url ?? undefined,
		headRepoOwner: pr.head.repo?.owner?.login ?? undefined,
		headRepoName: pr.head.repo?.name ?? undefined,
		maintainerCanModify: pr.maintainer_can_modify ?? undefined,
		repoOwner: pr.base.repo?.owner?.login ?? undefined,
		repoName: pr.base.repo?.name ?? undefined
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
			avatarUrl: run.app?.owner?.avatar_url ?? null
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
				avatarUrl: s.avatar_url ?? null
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
		line: c.line ?? c.original_line ?? null,
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
	// SHA of the commit the on-screen diff was rendered from (the local
	// `pr/<n>/head` snapshot). Anchoring the comment here — rather than the PR's
	// live head — guarantees the line/side the user clicked resolve against the
	// same diff they're looking at, even if the PR gained commits since it loaded.
	// Falls back to the live head when the snapshot can't be resolved.
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
		// PR's diff at the head commit with a 422 "could not be resolved". This
		// almost always means the on-screen diff is anchored to a different commit
		// than the PR's current head (e.g. the PR was rebased/force-pushed since it
		// was loaded), so the line no longer maps. Surface something actionable
		// instead of the raw API validation error.
		const status = (err as { status?: number }).status;
		const errors = (err as { response?: { data?: { errors?: Array<{ field?: string }> } } })
			.response?.data?.errors;
		const unresolvablePath = errors?.some((e) => e.field?.endsWith('.path'));
		if (status === 422 && unresolvablePath) {
			throw new Error(
				`GitHub couldn't place this comment on ${input.path}:${input.line} — that line isn't ` +
					`part of the PR's current diff. The PR was likely updated since you opened it; ` +
					`refresh the PR and try again.`,
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
