import { Octokit } from '@octokit/rest';
import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import { shell } from 'electron';
import type {
  DeviceFlowStart,
  DeviceFlowStatus,
  GithubAccount,
  NewReviewCommentInput,
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

function octokit(): Octokit {
  const account = getActiveGithubAccount();
  if (!account) throw new Error('Not authenticated with GitHub. Sign in first.');
  return new Octokit({ auth: account.token });
}

export async function listPullRequests(
  owner: string,
  repo: string,
): Promise<PRSummary[]> {
  const o = octokit();
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
): Promise<{ baseRef: string; headRef: string }> {
  const o = octokit();
  const res = await o.pulls.get({ owner, repo, pull_number: prNumber });
  return { baseRef: res.data.base.ref, headRef: res.data.head.ref };
}

export async function getPRSummary(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRSummary | null> {
  const o = octokit();
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
): Promise<PRReviewComment[]> {
  const o = octokit();
  const viewer = getActiveGithubAccount();
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
): Promise<PRReviewComment> {
  const o = octokit();
  const viewer = getActiveGithubAccount();
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
): Promise<PRReviewComment> {
  const o = octokit();
  const viewer = getActiveGithubAccount();
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
): Promise<void> {
  const o = octokit();
  await o.pulls.deleteReviewComment({ owner, repo, comment_id: commentId });
}

// Returns the open PR whose head branch matches `branch`, or null.
// `branch` is expected to be the local branch name — same as headRef.
export async function findPRForBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<PRSummary | null> {
  const o = octokit();
  const res = await o.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,
    per_page: 1,
  });
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
