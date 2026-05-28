import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  BranchInfo,
  ChangedFile,
  CloneResult,
  CommitResult,
  DeviceFlowStart,
  DeviceFlowStatus,
  DiffContext,
  DiffData,
  EditorKind,
  GithubAccount,
  LastCommit,
  NewReviewCommentInput,
  PRReviewComment,
  PRSummary,
  PullPushResult,
  PushStatus,
  RepoInfo,
  TerminalKind,
  UserPrefs,
} from "@shared/types.js";
import {
  abortMerge,
  buildRepoInfo,
  checkout,
  cloneRepo,
  commitAll,
  continueMerge,
  createBranch,
  fetchOrigin,
  fetchPRRef,
  getConflicts,
  getCurrentBranch,
  getDiff,
  getLastCommit,
  getPushStatus,
  initRepo,
  isGitRepo,
  isWorkingTreeDirty,
  listBranches,
  listChangedFiles,
  pinPRBaseRef,
  pull,
  push,
  stageFile,
  undoLastCommit,
} from "./git-service.js";
import {
  detectEditors,
  detectTerminals,
  openInEditor,
  openInTerminal,
} from "./editor-service.js";
import * as gh from "./github-service.js";
import {
  clearCollapsedFiles,
  clearSeen,
  getCollapsedFiles,
  getPrefs,
  getRepo,
  getSeen,
  listRepos,
  removeRepo,
  setFileCollapsed,
  setPrefs,
  setSeen,
  upsertRepo,
} from "./store.js";

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

// Re-run buildRepoInfo off the critical path. If anything moved (favicon
// added, remote URL changed, default branch updated) we persist and re-emit
// active-changed so the UI picks it up. No-op when nothing changed.
async function refreshRepoInfoInBackground(
  repoPath: string,
  previous: RepoInfo,
): Promise<void> {
  try {
    const fresh = await buildRepoInfo(repoPath);
    const merged: RepoInfo = { ...fresh, lastOpenedAt: previous.lastOpenedAt };
    const changed =
      merged.iconDataUrl !== previous.iconDataUrl ||
      merged.remoteUrl !== previous.remoteUrl ||
      merged.defaultBranch !== previous.defaultBranch ||
      merged.githubOwner !== previous.githubOwner ||
      merged.githubRepo !== previous.githubRepo ||
      merged.name !== previous.name;
    if (!changed) return;
    upsertRepo(merged);
    broadcast("repos:active-changed", merged);
  } catch {
    // Background refresh — failure is silent.
  }
}

export function registerIpc(): void {
  // ─── Repos ─────────────────────────────────────────────────────────────
  ipcMain.handle("repos:list", async (): Promise<RepoInfo[]> => listRepos());

  ipcMain.handle("repos:openPicker", async (): Promise<RepoInfo | null> => {
    const result = await dialog.showOpenDialog({
      title: "Open repository",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const repoPath = result.filePaths[0];
    if (!(await isGitRepo(repoPath))) {
      throw new Error(`Not a git repository: ${repoPath}`);
    }
    const info = await buildRepoInfo(repoPath);
    upsertRepo(info);
    setPrefs({ activeRepoId: info.id });
    broadcast("repos:active-changed", info);
    return info;
  });

  ipcMain.handle("repos:createPicker", async (): Promise<RepoInfo | null> => {
    const result = await dialog.showOpenDialog({
      title: "Create new repository",
      buttonLabel: "Initialize here",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const target = result.filePaths[0];
    const init = await initRepo(target);
    if (!init.ok)
      throw new Error(init.error ?? "Failed to initialize repository.");
    const info = await buildRepoInfo(target);
    upsertRepo(info);
    setPrefs({ activeRepoId: info.id });
    broadcast("repos:active-changed", info);
    return info;
  });

  ipcMain.handle("repos:remove", async (_e, id: string) => {
    removeRepo(id);
  });

  ipcMain.handle(
    "repos:setActive",
    async (_e, id: string): Promise<RepoInfo | null> => {
      const repo = getRepo(id);
      if (!repo) return null;
      // Switching needs to feel instant — buildRepoInfo rescans the favicon
      // tree, queries git remotes, and resolves origin/HEAD, easily adding
      // 100ms-1s on a large repo. None of that data changes between switches,
      // so we return the stored info immediately and refresh in the background.
      const updated: RepoInfo = { ...repo, lastOpenedAt: Date.now() };
      upsertRepo(updated);
      setPrefs({ activeRepoId: id });
      broadcast("repos:active-changed", updated);

      void refreshRepoInfoInBackground(repo.path, updated);
      return updated;
    },
  );

  ipcMain.handle("repos:getActive", async (): Promise<RepoInfo | null> => {
    const prefs = getPrefs();
    if (!prefs.activeRepoId) return null;
    return getRepo(prefs.activeRepoId);
  });

  // ─── Git ───────────────────────────────────────────────────────────────
  ipcMain.handle(
    "git:listBranches",
    async (_e, repoId: string): Promise<BranchInfo[]> => {
      return listBranches(repoOrThrow(repoId).path);
    },
  );

  ipcMain.handle(
    "git:getCurrentBranch",
    async (_e, repoId: string): Promise<string | null> => {
      return getCurrentBranch(repoOrThrow(repoId).path);
    },
  );

  ipcMain.handle("git:checkout", async (_e, repoId: string, branch: string) => {
    await checkout(repoOrThrow(repoId).path, branch);
  });

  ipcMain.handle(
    "git:isDirty",
    async (_e, repoId: string): Promise<boolean> => {
      return isWorkingTreeDirty(repoOrThrow(repoId).path);
    },
  );

  ipcMain.handle(
    "git:createBranch",
    async (
      _e,
      repoId: string,
      name: string,
      opts: { base?: string; checkout: boolean },
    ) => createBranch(repoOrThrow(repoId).path, name, opts),
  );

  ipcMain.handle(
    "git:listChangedFiles",
    async (_e, repoId: string, ctx: DiffContext): Promise<ChangedFile[]> => {
      return listChangedFiles(repoOrThrow(repoId).path, ctx);
    },
  );

  ipcMain.handle(
    "git:getDiff",
    async (
      _e,
      repoId: string,
      filePath: string,
      ctx: DiffContext,
    ): Promise<DiffData> => {
      return getDiff(repoOrThrow(repoId).path, filePath, ctx);
    },
  );

  ipcMain.handle("git:fetchOrigin", async (_e, repoId: string) => {
    return fetchOrigin(repoOrThrow(repoId).path);
  });

  ipcMain.handle(
    "git:getPushStatus",
    async (_e, repoId: string): Promise<PushStatus> => {
      const repo = repoOrThrow(repoId);
      return getPushStatus(repo.path, repo.defaultBranch);
    },
  );

  ipcMain.handle(
    "git:pull",
    async (_e, repoId: string): Promise<PullPushResult> =>
      pull(repoOrThrow(repoId).path),
  );

  ipcMain.handle(
    "git:push",
    async (_e, repoId: string): Promise<PullPushResult> =>
      push(repoOrThrow(repoId).path),
  );

  ipcMain.handle(
    "git:getConflicts",
    async (_e, repoId: string): Promise<string[]> =>
      getConflicts(repoOrThrow(repoId).path),
  );

  ipcMain.handle(
    "git:stageFile",
    async (_e, repoId: string, filePath: string): Promise<void> =>
      stageFile(repoOrThrow(repoId).path, filePath),
  );

  ipcMain.handle(
    "git:continueMerge",
    async (_e, repoId: string): Promise<PullPushResult> =>
      continueMerge(repoOrThrow(repoId).path),
  );

  ipcMain.handle(
    "git:abortMerge",
    async (_e, repoId: string): Promise<void> => {
      await abortMerge(repoOrThrow(repoId).path);
    },
  );

  ipcMain.handle(
    "git:commitAll",
    async (_e, repoId: string, message: string): Promise<CommitResult> =>
      commitAll(repoOrThrow(repoId).path, message),
  );

  ipcMain.handle(
    "git:getLastCommit",
    async (_e, repoId: string): Promise<LastCommit | null> =>
      getLastCommit(repoOrThrow(repoId).path),
  );

  ipcMain.handle(
    "git:undoLastCommit",
    async (_e, repoId: string): Promise<CommitResult> =>
      undoLastCommit(repoOrThrow(repoId).path),
  );

  ipcMain.handle(
    "git:cloneRepo",
    async (_e, url: string): Promise<CloneResult> => {
      const dir = await dialog.showOpenDialog({
        title: "Clone destination",
        properties: ["openDirectory", "createDirectory"],
      });
      if (dir.canceled || dir.filePaths.length === 0) {
        return { ok: false, error: "Clone cancelled." };
      }
      const result = await cloneRepo(url, dir.filePaths[0]);
      if (result.ok && result.path) {
        const info = await buildRepoInfo(result.path);
        upsertRepo(info);
        setPrefs({ activeRepoId: info.id });
        broadcast("repos:active-changed", info);
      }
      return result;
    },
  );

  // ─── Editor ────────────────────────────────────────────────────────────
  ipcMain.handle("editor:detect", async () => detectEditors());
  ipcMain.handle(
    "editor:open",
    async (_e, editor: EditorKind, target: string) =>
      openInEditor(editor, target),
  );

  // ─── Terminal ──────────────────────────────────────────────────────────
  ipcMain.handle("terminal:detect", async () => detectTerminals());
  ipcMain.handle(
    "terminal:open",
    async (_e, terminal: TerminalKind, target: string) =>
      openInTerminal(terminal, target),
  );

  // ─── GitHub ────────────────────────────────────────────────────────────
  ipcMain.handle(
    "github:listAccounts",
    async (): Promise<GithubAccount[]> => gh.listAccounts(),
  );
  ipcMain.handle(
    "github:getActiveAccount",
    async (): Promise<GithubAccount | null> => gh.getActiveAccount(),
  );
  ipcMain.handle(
    "github:setActiveAccount",
    async (_e, id: string): Promise<GithubAccount | null> =>
      gh.setActiveAccount(id),
  );
  ipcMain.handle("github:removeAccount", async (_e, id: string) =>
    gh.removeAccount(id),
  );
  ipcMain.handle(
    "github:startDeviceFlow",
    async (): Promise<DeviceFlowStart> => gh.startDeviceFlow(),
  );
  ipcMain.handle(
    "github:pollDeviceFlow",
    async (): Promise<DeviceFlowStatus> => gh.pollDeviceFlow(),
  );
  ipcMain.handle("github:cancelDeviceFlow", async () => gh.cancelDeviceFlow());

  ipcMain.handle(
    "github:listPRs",
    async (_e, repoId: string): Promise<PRSummary[]> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return gh.listPullRequests(repo.githubOwner, repo.githubRepo);
    },
  );

  ipcMain.handle(
    "github:fetchPR",
    async (
      _e,
      repoId: string,
      prNumber: number,
    ): Promise<{ headRef: string; baseRef: string }> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      const { baseRef } = await gh.getPRBase(
        repo.githubOwner,
        repo.githubRepo,
        prNumber,
      );
      const refs = await fetchPRRef(repo.path, prNumber);
      await pinPRBaseRef(repo.path, prNumber, baseRef);
      return refs;
    },
  );

  ipcMain.handle(
    "github:findPRForBranch",
    async (_e, repoId: string, branch: string): Promise<PRSummary | null> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) return null;
      try {
        return await gh.findPRForBranch(
          repo.githubOwner,
          repo.githubRepo,
          branch,
        );
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    "github:getPR",
    async (_e, repoId: string, prNumber: number): Promise<PRSummary | null> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) return null;
      return gh.getPRSummary(repo.githubOwner, repo.githubRepo, prNumber);
    },
  );

  ipcMain.handle(
    "github:listReviewComments",
    async (
      _e,
      repoId: string,
      prNumber: number,
    ): Promise<PRReviewComment[]> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return gh.listReviewComments(repo.githubOwner, repo.githubRepo, prNumber);
    },
  );

  ipcMain.handle(
    "github:createReviewComment",
    async (
      _e,
      repoId: string,
      input: NewReviewCommentInput,
    ): Promise<PRReviewComment> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return gh.createReviewComment(repo.githubOwner, repo.githubRepo, input);
    },
  );

  ipcMain.handle(
    "github:replyReviewComment",
    async (
      _e,
      repoId: string,
      prNumber: number,
      commentId: number,
      body: string,
    ): Promise<PRReviewComment> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return gh.replyReviewComment(
        repo.githubOwner,
        repo.githubRepo,
        prNumber,
        commentId,
        body,
      );
    },
  );

  ipcMain.handle(
    "github:deleteReviewComment",
    async (_e, repoId: string, commentId: number): Promise<void> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      await gh.deleteReviewComment(
        repo.githubOwner,
        repo.githubRepo,
        commentId,
      );
    },
  );

  // ─── Shell ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    "shell:openExternal",
    async (_e, url: string): Promise<void> => {
      await shell.openExternal(url);
    },
  );

  // ─── State ─────────────────────────────────────────────────────────────
  ipcMain.handle("state:getPrefs", async (): Promise<UserPrefs> => getPrefs());
  ipcMain.handle(
    "state:setPrefs",
    async (_e, patch: Partial<UserPrefs>): Promise<UserPrefs> =>
      setPrefs(patch),
  );

  ipcMain.handle(
    "state:getSeenFiles",
    async (_e, repoId: string, contextKey: string): Promise<string[]> => {
      return getSeen(repoId, contextKey);
    },
  );

  ipcMain.handle(
    "state:setFileSeen",
    async (
      _e,
      repoId: string,
      contextKey: string,
      filePath: string,
      seen: boolean,
    ) => {
      setSeen(repoId, contextKey, filePath, seen);
    },
  );

  ipcMain.handle(
    "state:clearSeen",
    async (_e, repoId: string, contextKey: string) =>
      clearSeen(repoId, contextKey),
  );

  ipcMain.handle(
    "state:getCollapsedFiles",
    async (_e, repoId: string, contextKey: string): Promise<string[]> => {
      return getCollapsedFiles(repoId, contextKey);
    },
  );

  ipcMain.handle(
    "state:setFileCollapsed",
    async (
      _e,
      repoId: string,
      contextKey: string,
      filePath: string,
      collapsed: boolean,
    ) => {
      setFileCollapsed(repoId, contextKey, filePath, collapsed);
    },
  );

  ipcMain.handle(
    "state:clearCollapsedFiles",
    async (_e, repoId: string, contextKey: string) =>
      clearCollapsedFiles(repoId, contextKey),
  );
}
