import { Octokit } from '@octokit/rest';
import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import { shell } from 'electron';
import type {
  DeviceFlowStart,
  DeviceFlowStatus,
  PRSummary,
} from '@shared/types.js';
import { getGithubToken, setGithubToken } from './store.js';

// Default GitHub OAuth client ID for "GitHub CLI" - public, ships with `gh`.
// Users can override via env var for self-hosted GHE later.
const CLIENT_ID = process.env.SUPER_LOCAL_REVIEW_GH_CLIENT_ID ?? '178c6fc778ccc68e1d6a';
const SCOPES = ['repo', 'read:user'];

interface PendingDeviceFlow {
  resolveSignIn: (ok: boolean, errMsg?: string) => void;
  cancel: () => void;
}

let pending: PendingDeviceFlow | null = null;
let lastStatus: DeviceFlowStatus = { state: 'pending' };

export function isAuthenticated(): boolean {
  return !!getGithubToken();
}

export async function signOut(): Promise<void> {
  setGithubToken(null);
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  if (pending) pending.cancel();
  lastStatus = { state: 'pending' };

  let opened: DeviceFlowStart | null = null;
  let openedResolve: ((v: DeviceFlowStart) => void) | null = null;
  const openedPromise = new Promise<DeviceFlowStart>((resolve) => {
    openedResolve = resolve;
  });

  let cancelled = false;
  pending = {
    resolveSignIn: () => {},
    cancel: () => {
      cancelled = true;
    },
  };

  const auth = createOAuthDeviceAuth({
    clientType: 'oauth-app',
    clientId: CLIENT_ID,
    scopes: SCOPES,
    onVerification(verification) {
      opened = {
        userCode: verification.user_code,
        verificationUri: verification.verification_uri,
        expiresInSec: verification.expires_in,
        intervalSec: verification.interval,
      };
      openedResolve?.(opened);
      void shell.openExternal(verification.verification_uri);
    },
  });

  // Kick off auth in background — it will poll until success or cancel.
  void (async () => {
    try {
      const result = await auth({ type: 'oauth' });
      if (cancelled) return;
      setGithubToken(result.token);
      lastStatus = { state: 'success' };
    } catch (err) {
      if (cancelled) return;
      lastStatus = {
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
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
  const token = getGithubToken();
  if (!token) throw new Error('Not authenticated with GitHub. Sign in first.');
  return new Octokit({ auth: token });
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
