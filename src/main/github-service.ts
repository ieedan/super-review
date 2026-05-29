import { Octokit } from '@octokit/rest';
import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import { shell } from 'electron';
import type {
  DeviceFlowStart,
  DeviceFlowStatus,
  GitIdentity,
  GithubAccount,
  NewReviewCommentInput,
  PRCheck,
  PRChecksState,
  PRChecksSummary,
  PRReviewComment,
  PRSummary,
} from '@shared/types.js';
import {
  clearLegacyGithubToken,
  getActiveGithubAccount,
  getGithubAccount,
  getLegacyGithubToken,
  listGithubAccounts,
  removeGithubAccount as storeRemoveAccount,
  setActiveGithubAccountId,
  upsertGithubAccount,
  type StoredGithubAccount,
} from './store.js';

// Default GitHub OAuth client ID for "GitHub CLI" - public, ships with `gh`.
// Users can override via env var for self-hosted GHE later.
const CLIENT_ID = process.env.SUPER_LOCAL_REVIEW_GH_CLIENT_ID ?? '178c6fc778ccc68e1d6a';
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
    token,
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
    },
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
        intervalSec: verification.interval,
      });
      void shell.openExternal(verification.verification_uri);
    },
  });

  // Kick off auth in background — it will poll until success or cancel.
  void (async () => {
    try {
      const result = await auth({ type: 'oauth' });
      if (cancelled) return;
      const account = await fetchAccountForToken(result.token);
      upsertGithubAccount(account);
      setActiveGithubAccountId(account.id);
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

function octokit(account: StoredGithubAccount): Octokit {
  return new Octokit({ auth: account.token });
}

// The author/committer identity for commits made under a given account. Uses
// GitHub's no-reply email format so commits are attributed to that account.
export function resolveCommitIdentity(accountId?: string | null): GitIdentity | null {
  const pinned = accountId ? getGithubAccount(accountId) : null;
  const account = pinned ?? getActiveGithubAccount();
  if (!account) return null;
  return {
    name: account.name ?? account.login,
    email: `${account.id}+${account.login}@users.noreply.github.com`,
  };
}

export async function listPullRequests(
  owner: string,
  repo: string,
  accountId?: string | null,
): Promise<PRSummary[]> {
  const o = octokit(resolveAccount(accountId));
  const res = await o.pulls.list({
    owner,
    repo,
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    per_page: 50,
  });
  return res.data.map((pr) => ({
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
  }));
}

export async function getPRBase(
  owner: string,
  repo: string,
  prNumber: number,
  accountId?: string | null,
): Promise<{ baseRef: string; headRef: string }> {
  const o = octokit(resolveAccount(accountId));
  const res = await o.pulls.get({ owner, repo, pull_number: prNumber });
  return { baseRef: res.data.base.ref, headRef: res.data.head.ref };
}

export async function getPRSummary(
  owner: string,
  repo: string,
  prNumber: number,
  accountId?: string | null,
): Promise<PRSummary | null> {
  const o = octokit(resolveAccount(accountId));
  try {
    const res = await o.pulls.get({ owner, repo, pull_number: prNumber });
    const pr = res.data;
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
    };
  } catch {
    return null;
  }
}

// Map a single check-run's status/conclusion to our tri-state.
function checkRunState(
  status: string,
  conclusion: string | null,
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

// Aggregate GitHub Actions check-runs and legacy commit statuses for a ref,
// returning both the rolled-up state and the individual checks (name, state,
// run time) for a hover breakdown. `state` is 'none' when nothing reports.
export async function getChecks(
  owner: string,
  repo: string,
  ref: string,
  accountId?: string | null,
): Promise<PRChecksSummary> {
  const o = octokit(resolveAccount(accountId));
  const [runs, combined] = await Promise.all([
    o.checks.listForRef({ owner, repo, ref, per_page: 100 }),
    o.repos.getCombinedStatusForRef({ owner, repo, ref }).catch(() => null),
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
    });
  }

  // Legacy commit statuses (e.g. older CI integrations) don't surface timing,
  // so they show up without a duration.
  if (combined) {
    for (const s of combined.data.statuses) {
      const state: PRChecksState =
        s.state === 'success'
          ? 'success'
          : s.state === 'pending'
            ? 'pending'
            : 'failure';
      checks.push({
        name: s.context,
        state,
        durationMs: null,
        avatarUrl: s.avatar_url ?? null,
      });
    }
  }

  return { state: rollupChecks(checks), checks };
}

function mapReviewComment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  prNumber: number,
  viewerLogin: string | null,
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
  };
}

export async function listReviewComments(
  owner: string,
  repo: string,
  prNumber: number,
  accountId?: string | null,
): Promise<PRReviewComment[]> {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  const all = await o.paginate(o.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  return all.map((c) => mapReviewComment(c, prNumber, viewer?.login ?? null));
}

export async function createReviewComment(
  owner: string,
  repo: string,
  input: NewReviewCommentInput,
  accountId?: string | null,
): Promise<PRReviewComment> {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  // Need the head commit SHA to anchor the comment.
  const pr = await o.pulls.get({ owner, repo, pull_number: input.prNumber });
  const res = await o.pulls.createReviewComment({
    owner,
    repo,
    pull_number: input.prNumber,
    body: input.body,
    commit_id: pr.data.head.sha,
    path: input.path,
    line: input.line,
    side: input.side,
  });
  return mapReviewComment(res.data, input.prNumber, viewer?.login ?? null);
}

export async function replyReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
  accountId?: string | null,
): Promise<PRReviewComment> {
  const viewer = resolveAccount(accountId);
  const o = octokit(viewer);
  const res = await o.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    comment_id: commentId,
    body,
  });
  return mapReviewComment(res.data, prNumber, viewer?.login ?? null);
}

export async function deleteReviewComment(
  owner: string,
  repo: string,
  commentId: number,
  accountId?: string | null,
): Promise<void> {
  const o = octokit(resolveAccount(accountId));
  await o.pulls.deleteReviewComment({ owner, repo, comment_id: commentId });
}

// Returns the open PR whose head branch matches `branch`, or null.
// `branch` is expected to be the local branch name — same as headRef.
export async function findPRForBranch(
  owner: string,
  repo: string,
  branch: string,
  accountId?: string | null,
): Promise<PRSummary | null> {
  const account = resolveAccount(accountId);
  console.log(
    `[github] findPRForBranch owner=${owner} repo=${repo} branch=${branch} ` +
      `requestedAccountId=${accountId ?? '(none → app default)'} ` +
      `usingAccount=${account.login} (id=${account.id})`,
  );
  const o = octokit(account);
  const res = await o.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,
    per_page: 1,
  });
  console.log(
    `[github] findPRForBranch head=${owner}:${branch} → ${res.data.length} match(es)` +
      (res.data[0] ? ` (PR #${res.data[0].number})` : ''),
  );
  const pr = res.data[0];
  if (!pr) return null;
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
  };
}
