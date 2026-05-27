import { BrowserWindow, dialog, ipcMain } from 'electron';
import type {
  BranchInfo,
  ChangedFile,
  DeviceFlowStart,
  DeviceFlowStatus,
  DiffContext,
  DiffData,
  PRSummary,
  RepoInfo,
  UserPrefs,
} from '@shared/types.js';
import {
  buildRepoInfo,
  checkout,
  fetchPRRef,
  getCurrentBranch,
  getDiff,
  isGitRepo,
  listBranches,
  listChangedFiles,
  pinPRBaseRef,
} from './git-service.js';
import * as gh from './github-service.js';
import {
  clearSeen,
  getPrefs,
  getRepo,
  getSeen,
  listRepos,
  removeRepo,
  setPrefs,
  setSeen,
  upsertRepo,
} from './store.js';

function repoOrThrow(id: string): RepoInfo {
  const repo = getRepo(id);
  if (!repo) throw new Error(`Repo not found: ${id}`);
  return repo;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

export function registerIpc(): void {
  // ─── Repos ─────────────────────────────────────────────────────────────
  ipcMain.handle('repos:list', async (): Promise<RepoInfo[]> => listRepos());

  ipcMain.handle('repos:openPicker', async (): Promise<RepoInfo | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Open repository',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const repoPath = result.filePaths[0];
    if (!(await isGitRepo(repoPath))) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
    const info = await buildRepoInfo(repoPath);
    upsertRepo(info);
    setPrefs({ activeRepoId: info.id });
    broadcast('repos:active-changed', info);
    return info;
  });

  ipcMain.handle('repos:remove', async (_e, id: string) => {
    removeRepo(id);
  });

  ipcMain.handle('repos:setActive', async (_e, id: string): Promise<RepoInfo | null> => {
    const repo = getRepo(id);
    if (!repo) return null;
    const refreshed = await buildRepoInfo(repo.path).catch(() => repo);
    upsertRepo(refreshed);
    setPrefs({ activeRepoId: id });
    broadcast('repos:active-changed', refreshed);
    return refreshed;
  });

  ipcMain.handle('repos:getActive', async (): Promise<RepoInfo | null> => {
    const prefs = getPrefs();
    if (!prefs.activeRepoId) return null;
    return getRepo(prefs.activeRepoId);
  });

  // ─── Git ───────────────────────────────────────────────────────────────
  ipcMain.handle('git:listBranches', async (_e, repoId: string): Promise<BranchInfo[]> => {
    return listBranches(repoOrThrow(repoId).path);
  });

  ipcMain.handle('git:getCurrentBranch', async (_e, repoId: string): Promise<string | null> => {
    return getCurrentBranch(repoOrThrow(repoId).path);
  });

  ipcMain.handle('git:checkout', async (_e, repoId: string, branch: string) => {
    await checkout(repoOrThrow(repoId).path, branch);
  });

  ipcMain.handle(
    'git:listChangedFiles',
    async (_e, repoId: string, ctx: DiffContext): Promise<ChangedFile[]> => {
      return listChangedFiles(repoOrThrow(repoId).path, ctx);
    },
  );

  ipcMain.handle(
    'git:getDiff',
    async (_e, repoId: string, filePath: string, ctx: DiffContext): Promise<DiffData> => {
      return getDiff(repoOrThrow(repoId).path, filePath, ctx);
    },
  );

  // ─── GitHub ────────────────────────────────────────────────────────────
  ipcMain.handle('github:isAuthenticated', async () => gh.isAuthenticated());
  ipcMain.handle('github:startDeviceFlow', async (): Promise<DeviceFlowStart> =>
    gh.startDeviceFlow(),
  );
  ipcMain.handle('github:pollDeviceFlow', async (): Promise<DeviceFlowStatus> =>
    gh.pollDeviceFlow(),
  );
  ipcMain.handle('github:cancelDeviceFlow', async () => gh.cancelDeviceFlow());
  ipcMain.handle('github:signOut', async () => gh.signOut());

  ipcMain.handle('github:listPRs', async (_e, repoId: string): Promise<PRSummary[]> => {
    const repo = repoOrThrow(repoId);
    if (!repo.githubOwner || !repo.githubRepo) {
      throw new Error('This repository does not have a GitHub remote.');
    }
    return gh.listPullRequests(repo.githubOwner, repo.githubRepo);
  });

  ipcMain.handle(
    'github:fetchPR',
    async (_e, repoId: string, prNumber: number): Promise<{ headRef: string; baseRef: string }> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error('This repository does not have a GitHub remote.');
      }
      const { baseRef } = await gh.getPRBase(repo.githubOwner, repo.githubRepo, prNumber);
      const refs = await fetchPRRef(repo.path, prNumber);
      await pinPRBaseRef(repo.path, prNumber, baseRef);
      return refs;
    },
  );

  // ─── State ─────────────────────────────────────────────────────────────
  ipcMain.handle('state:getPrefs', async (): Promise<UserPrefs> => getPrefs());
  ipcMain.handle(
    'state:setPrefs',
    async (_e, patch: Partial<UserPrefs>): Promise<UserPrefs> => setPrefs(patch),
  );

  ipcMain.handle(
    'state:getSeenFiles',
    async (_e, repoId: string, contextKey: string): Promise<string[]> => {
      return getSeen(repoId, contextKey);
    },
  );

  ipcMain.handle(
    'state:setFileSeen',
    async (_e, repoId: string, contextKey: string, filePath: string, seen: boolean) => {
      setSeen(repoId, contextKey, filePath, seen);
    },
  );

  ipcMain.handle(
    'state:clearSeen',
    async (_e, repoId: string, contextKey: string) => clearSeen(repoId, contextKey),
  );
}
