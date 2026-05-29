import { BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type {
  BranchInfo,
  ChangedFile,
  CloneResult,
  CommitDraft,
  CommitResult,
  DeviceFlowStart,
  DeviceFlowStatus,
  DiffContext,
  DiffData,
  EditorKind,
  FileContextMenuAction,
  FileContextMenuParams,
  GithubAccount,
  LastCommit,
  NewReviewCommentInput,
  PRChecksSummary,
  PRReviewComment,
  PRSource,
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
  checkoutPR,
  cloneRepo,
  commitAll,
  continueMerge,
  createBranch,
  discardChanges,
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
  getCommitDraft,
  getPrefs,
  getRepo,
  getSeen,
  listRepos,
  removeRepo,
  setCommitDraft,
  setFileCollapsed,
  setPrefs,
  getPRBranch,
  setPRBranch,
  setRepoGithubAccountId,
  setRepoUpstream,
  setSeen,
  upsertRepo,
} from "./store.js";

function repoOrThrow(id: string): RepoInfo {
  const repo = getRepo(id);
  if (!repo) throw new Error(`Repo not found: ${id}`);
  return repo;
}

// A git-fetchable URL for the fork's upstream repo. Derived by swapping the
// owner/repo segment of the fork's own remote URL so the auth method (SSH vs
// HTTPS) and host are preserved; falls back to a public github.com HTTPS URL.
function upstreamFetchUrl(repo: RepoInfo): string {
  const { remoteUrl, githubOwner, githubRepo, upstreamOwner, upstreamRepo } =
    repo;
  if (remoteUrl && githubOwner && githubRepo) {
    const swapped = remoteUrl.replace(
      `${githubOwner}/${githubRepo}`,
      `${upstreamOwner}/${upstreamRepo}`,
    );
    if (swapped !== remoteUrl) return swapped;
  }
  return `https://github.com/${upstreamOwner}/${upstreamRepo}.git`;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

// Re-run buildRepoInfo off the critical path. If anything moved (favicon
// added, remote URL changed, default branch updated) we persist and re-emit
// active-changed so the UI picks it up. No-op when nothing changed.
// buildRepoInfo derives only git/path metadata. When re-opening a repo we've
// seen before (id is path-derived), carry over the user's pinned account so it
// isn't clobbered by the rebuilt record.
function preservePinnedAccount(info: RepoInfo): RepoInfo {
  const existing = getRepo(info.id);
  return existing?.githubAccountId
    ? { ...info, githubAccountId: existing.githubAccountId }
    : info;
}

async function refreshRepoInfoInBackground(
  repoPath: string,
  previous: RepoInfo,
): Promise<void> {
  try {
    const fresh = await buildRepoInfo(repoPath);
    // buildRepoInfo only derives git/path metadata, so carry over fields the
    // user owns (last-opened time, the project's pinned GitHub account).
    const merged: RepoInfo = {
      ...fresh,
      lastOpenedAt: previous.lastOpenedAt,
      githubAccountId: previous.githubAccountId,
    };
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
    const info = preservePinnedAccount(await buildRepoInfo(repoPath));
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
    const info = preservePinnedAccount(await buildRepoInfo(target));
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
    "git:checkoutPR",
    async (_e, repoId: string, pr: PRSummary, source: PRSource = "fork") => {
      const repo = repoOrThrow(repoId);
      // Base remote used only for the read-only fallback (deleted head repo).
      const fallbackRemote =
        source === "upstream" && repo.upstreamOwner && repo.upstreamRepo
          ? upstreamFetchUrl(repo)
          : "origin";
      await checkoutPR(repo.path, {
        prNumber: pr.number,
        headRef: pr.headRef,
        headRepoUrl: pr.headRepoCloneUrl,
        headRepoOwner: pr.headRepoOwner,
        originUrl: repo.remoteUrl,
        fallbackRemote,
      });
      // Remember which PR this branch maps to so the UI resolves "View PR"
      // later, even for cross-repo PRs a head-based lookup can't find.
      setPRBranch(repoId, pr.headRef, { number: pr.number, source });
    },
  );

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
    "git:discardChanges",
    async (
      _e,
      repoId: string,
      filePath: string,
      oldPath?: string,
    ): Promise<void> =>
      discardChanges(repoOrThrow(repoId).path, filePath, oldPath),
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
    async (_e, repoId: string, message: string): Promise<CommitResult> => {
      const repo = repoOrThrow(repoId);
      const identity = gh.resolveCommitIdentity(repo.githubAccountId);
      return commitAll(repo.path, message, identity);
    },
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
        const info = preservePinnedAccount(await buildRepoInfo(result.path));
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
    "github:setRepoAccount",
    async (
      _e,
      repoId: string,
      accountId: string | null,
    ): Promise<RepoInfo | null> => {
      const updated = setRepoGithubAccountId(repoId, accountId);
      if (updated) broadcast("repos:active-changed", updated);
      return updated;
    },
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
    async (
      _e,
      repoId: string,
      page = 1,
      source: PRSource = "fork",
    ): Promise<PRSummary[]> => {
      const repo = repoOrThrow(repoId);
      const owner =
        source === "upstream" ? repo.upstreamOwner : repo.githubOwner;
      const name = source === "upstream" ? repo.upstreamRepo : repo.githubRepo;
      if (!owner || !name) {
        throw new Error(
          source === "upstream"
            ? "This repository does not have an upstream."
            : "This repository does not have a GitHub remote.",
        );
      }
      return gh.listPullRequests(owner, name, repo.githubAccountId, page);
    },
  );

  ipcMain.handle(
    "github:detectUpstream",
    async (_e, repoId: string): Promise<RepoInfo | null> => {
      const repo = repoOrThrow(repoId);
      if (!repo.githubOwner || !repo.githubRepo) return repo;
      let upstream: { owner: string; repo: string } | null = null;
      try {
        upstream = await gh.getUpstream(
          repo.githubOwner,
          repo.githubRepo,
          repo.githubAccountId,
        );
      } catch {
        upstream = null;
      }
      return setRepoUpstream(repoId, upstream) ?? repo;
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
        repo.githubAccountId,
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
      if (!repo.githubOwner || !repo.githubRepo) {
        console.log(
          `[github] findPRForBranch skipped: repo "${repo.name}" has no GitHub remote ` +
            `(owner=${repo.githubOwner ?? '∅'} repo=${repo.githubRepo ?? '∅'})`,
        );
        return null;
      }
      try {
        const pr = await gh.findPRForBranch(
          repo.githubOwner,
          repo.githubRepo,
          branch,
          repo.githubAccountId,
        );
        if (pr) return pr;
      } catch (err) {
        console.error(
          `[github] findPRForBranch failed for ${repo.githubOwner}/${repo.githubRepo} ` +
            `branch=${branch} pinnedAccountId=${repo.githubAccountId ?? '(none)'}:`,
          err instanceof Error ? err.message : err,
        );
      }
      // A head-based lookup misses cross-repo PRs (the head owner isn't us).
      // Fall back to the association we recorded when the branch was checked
      // out from the PR list, resolving against the right repo.
      const link = getPRBranch(repoId, branch);
      if (link) {
        const owner =
          link.source === "upstream" ? repo.upstreamOwner : repo.githubOwner;
        const name =
          link.source === "upstream" ? repo.upstreamRepo : repo.githubRepo;
        if (owner && name) {
          try {
            return await gh.getPRSummary(
              owner,
              name,
              link.number,
              repo.githubAccountId,
            );
          } catch {
            return null;
          }
        }
      }
      return null;
    },
  );

  ipcMain.handle(
    "github:canPushToPR",
    async (_e, repoId: string, pr: PRSummary): Promise<boolean> => {
      const repo = repoOrThrow(repoId);
      const baseOwner = pr.repoOwner ?? repo.githubOwner;
      const baseRepo = pr.repoName ?? repo.githubRepo;
      if (!baseOwner || !baseRepo) return false;
      try {
        return await gh.canPushToPR(
          {
            headOwner: pr.headRepoOwner,
            headRepo: pr.headRepoName,
            baseOwner,
            baseRepo,
            prNumber: pr.number,
            maintainerCanModify: pr.maintainerCanModify,
          },
          repo.githubAccountId,
        );
      } catch {
        return false;
      }
    },
  );

  ipcMain.handle(
    "github:getChecks",
    async (
      _e,
      repoId: string,
      ref: string,
      prOwner?: string,
      prRepo?: string,
    ): Promise<PRChecksSummary> => {
      const repo = repoOrThrow(repoId);
      const empty: PRChecksSummary = { state: "none", checks: [] };
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) return empty;
      try {
        return await gh.getChecks(owner, name, ref, repo.githubAccountId);
      } catch (err) {
        console.error(
          `[github] getChecks failed for ${owner}/${name} ref=${ref}:`,
          err instanceof Error ? err.message : err,
        );
        return empty;
      }
    },
  );

  ipcMain.handle(
    "github:getPR",
    async (
      _e,
      repoId: string,
      prNumber: number,
      prOwner?: string,
      prRepo?: string,
    ): Promise<PRSummary | null> => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) return null;
      return gh.getPRSummary(owner, name, prNumber, repo.githubAccountId);
    },
  );

  ipcMain.handle(
    "github:listReviewComments",
    async (
      _e,
      repoId: string,
      prNumber: number,
      prOwner?: string,
      prRepo?: string,
    ): Promise<PRReviewComment[]> => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return gh.listReviewComments(owner, name, prNumber, repo.githubAccountId);
    },
  );

  ipcMain.handle(
    "github:createReviewComment",
    async (
      _e,
      repoId: string,
      input: NewReviewCommentInput,
      prOwner?: string,
      prRepo?: string,
    ): Promise<PRReviewComment> => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return gh.createReviewComment(owner, name, input, repo.githubAccountId);
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
      prOwner?: string,
      prRepo?: string,
    ): Promise<PRReviewComment> => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      return gh.replyReviewComment(
        owner,
        name,
        prNumber,
        commentId,
        body,
        repo.githubAccountId,
      );
    },
  );

  ipcMain.handle(
    "github:deleteReviewComment",
    async (
      _e,
      repoId: string,
      commentId: number,
      prOwner?: string,
      prRepo?: string,
    ): Promise<void> => {
      const repo = repoOrThrow(repoId);
      const owner = prOwner ?? repo.githubOwner;
      const name = prRepo ?? repo.githubRepo;
      if (!owner || !name) {
        throw new Error("This repository does not have a GitHub remote.");
      }
      await gh.deleteReviewComment(owner, name, commentId, repo.githubAccountId);
    },
  );

  ipcMain.handle(
    "github:setReviewThreadResolved",
    async (
      _e,
      repoId: string,
      threadId: string,
      resolved: boolean,
    ): Promise<{ isResolved: boolean }> => {
      const repo = repoOrThrow(repoId);
      // threadId is a global GraphQL node id, so no owner/repo is needed —
      // only the account whose token authorizes the mutation.
      return gh.setReviewThreadResolved(
        threadId,
        resolved,
        repo.githubAccountId,
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

  // Reveal a file in the OS file manager (Finder / Explorer), selecting it.
  ipcMain.handle(
    "shell:showItemInFolder",
    async (_e, fullPath: string): Promise<void> => {
      shell.showItemInFolder(fullPath);
    },
  );

  // Open a file with the OS default program for its type. shell.openPath
  // resolves to an error string ("" on success), which we surface to the UI.
  ipcMain.handle(
    "shell:openPath",
    async (_e, fullPath: string): Promise<{ ok: boolean; error?: string }> => {
      const error = await shell.openPath(fullPath);
      return error ? { ok: false, error } : { ok: true };
    },
  );

  // ─── Menu ──────────────────────────────────────────────────────────────
  // Pop up a native OS context menu for a file row and resolve with the chosen
  // action. The renderer performs the action itself (reusing its git/shell
  // calls so it can refresh afterward); we only render the menu and — for the
  // destructive discard — gate it behind a native confirmation dialog.
  ipcMain.handle(
    "menu:showFileContextMenu",
    async (
      e,
      params: FileContextMenuParams,
    ): Promise<FileContextMenuAction | null> => {
      const win = BrowserWindow.fromWebContents(e.sender);
      let chosen: FileContextMenuAction | null = null;
      const item = (
        label: string,
        action: FileContextMenuAction,
      ): MenuItemConstructorOptions => ({
        label,
        click: () => {
          chosen = action;
        },
      });

      const template: MenuItemConstructorOptions[] = [];
      if (params.canDiscard) {
        template.push(item("Discard Changes", "discard"));
        template.push({ type: "separator" });
      }
      template.push(item("Copy File Path", "copyPath"));
      template.push(item("Copy Relative File Path", "copyRelativePath"));
      template.push({ type: "separator" });
      template.push(item(params.revealLabel, "reveal"));
      if (params.editorLabel) {
        template.push(item(`Open in ${params.editorLabel}`, "openInEditor"));
      }
      template.push(item("Open with Default Program", "openDefault"));

      const menu = Menu.buildFromTemplate(template);
      return await new Promise<FileContextMenuAction | null>((resolve) => {
        menu.popup({
          window: win ?? undefined,
          callback: () => resolve(chosen),
        });
      });
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

  ipcMain.handle(
    "state:getCommitDraft",
    async (_e, repoId: string): Promise<CommitDraft> => getCommitDraft(repoId),
  );

  ipcMain.handle(
    "state:setCommitDraft",
    async (_e, repoId: string, draft: CommitDraft): Promise<void> => {
      setCommitDraft(repoId, draft);
    },
  );
}
