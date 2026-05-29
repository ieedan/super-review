import { contextBridge, ipcRenderer } from "electron";
import type {
  BranchInfo,
  ChangedFile,
  CloneResult,
  CommitDraft,
  CommitResult,
  CreateBranchResult,
  DeviceFlowStart,
  DeviceFlowStatus,
  DiffContext,
  DiffData,
  EditorKind,
  GithubAccount,
  LastCommit,
  NewReviewCommentInput,
  PRChecksSummary,
  PRReviewComment,
  PRSummary,
  PreloadAPI,
  PullPushResult,
  PushStatus,
  RepoInfo,
  TerminalKind,
  UserPrefs,
} from "@shared/types.js";

const api: PreloadAPI = {
  platform:
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "win32"
        : "linux",
  repos: {
    list: () => ipcRenderer.invoke("repos:list") as Promise<RepoInfo[]>,
    openPicker: () =>
      ipcRenderer.invoke("repos:openPicker") as Promise<RepoInfo | null>,
    createPicker: () =>
      ipcRenderer.invoke("repos:createPicker") as Promise<RepoInfo | null>,
    remove: (id) => ipcRenderer.invoke("repos:remove", id) as Promise<void>,
    setActive: (id) =>
      ipcRenderer.invoke("repos:setActive", id) as Promise<RepoInfo | null>,
    getActive: () =>
      ipcRenderer.invoke("repos:getActive") as Promise<RepoInfo | null>,
  },
  git: {
    listBranches: (repoId) =>
      ipcRenderer.invoke("git:listBranches", repoId) as Promise<BranchInfo[]>,
    getCurrentBranch: (repoId) =>
      ipcRenderer.invoke("git:getCurrentBranch", repoId) as Promise<
        string | null
      >,
    checkout: (repoId, branch) =>
      ipcRenderer.invoke("git:checkout", repoId, branch) as Promise<void>,
    isDirty: (repoId) =>
      ipcRenderer.invoke("git:isDirty", repoId) as Promise<boolean>,
    createBranch: (repoId, name, opts) =>
      ipcRenderer.invoke(
        "git:createBranch",
        repoId,
        name,
        opts,
      ) as Promise<CreateBranchResult>,
    listChangedFiles: (repoId, ctx: DiffContext) =>
      ipcRenderer.invoke("git:listChangedFiles", repoId, ctx) as Promise<
        ChangedFile[]
      >,
    getDiff: (repoId, filePath, ctx: DiffContext) =>
      ipcRenderer.invoke(
        "git:getDiff",
        repoId,
        filePath,
        ctx,
      ) as Promise<DiffData>,
    fetchOrigin: (repoId) =>
      ipcRenderer.invoke("git:fetchOrigin", repoId) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    getPushStatus: (repoId) =>
      ipcRenderer.invoke("git:getPushStatus", repoId) as Promise<PushStatus>,
    pull: (repoId) =>
      ipcRenderer.invoke("git:pull", repoId) as Promise<PullPushResult>,
    push: (repoId) =>
      ipcRenderer.invoke("git:push", repoId) as Promise<PullPushResult>,
    getConflicts: (repoId) =>
      ipcRenderer.invoke("git:getConflicts", repoId) as Promise<string[]>,
    stageFile: (repoId, filePath) =>
      ipcRenderer.invoke("git:stageFile", repoId, filePath) as Promise<void>,
    continueMerge: (repoId) =>
      ipcRenderer.invoke(
        "git:continueMerge",
        repoId,
      ) as Promise<PullPushResult>,
    abortMerge: (repoId) =>
      ipcRenderer.invoke("git:abortMerge", repoId) as Promise<void>,
    commitAll: (repoId, message) =>
      ipcRenderer.invoke(
        "git:commitAll",
        repoId,
        message,
      ) as Promise<CommitResult>,
    getLastCommit: (repoId) =>
      ipcRenderer.invoke(
        "git:getLastCommit",
        repoId,
      ) as Promise<LastCommit | null>,
    undoLastCommit: (repoId) =>
      ipcRenderer.invoke("git:undoLastCommit", repoId) as Promise<CommitResult>,
    cloneRepo: (url) =>
      ipcRenderer.invoke("git:cloneRepo", url) as Promise<CloneResult>,
  },
  editor: {
    detect: () =>
      ipcRenderer.invoke("editor:detect") as Promise<
        Record<EditorKind, boolean>
      >,
    open: (editor: EditorKind, target: string) =>
      ipcRenderer.invoke("editor:open", editor, target) as Promise<{
        ok: boolean;
        error?: string;
      }>,
  },
  terminal: {
    detect: () =>
      ipcRenderer.invoke("terminal:detect") as Promise<
        Record<TerminalKind, boolean>
      >,
    open: (terminal: TerminalKind, target: string) =>
      ipcRenderer.invoke("terminal:open", terminal, target) as Promise<{
        ok: boolean;
        error?: string;
      }>,
  },
  github: {
    listAccounts: () =>
      ipcRenderer.invoke("github:listAccounts") as Promise<GithubAccount[]>,
    getActiveAccount: () =>
      ipcRenderer.invoke(
        "github:getActiveAccount",
      ) as Promise<GithubAccount | null>,
    setActiveAccount: (id) =>
      ipcRenderer.invoke(
        "github:setActiveAccount",
        id,
      ) as Promise<GithubAccount | null>,
    removeAccount: (id) =>
      ipcRenderer.invoke("github:removeAccount", id) as Promise<void>,
    setRepoAccount: (repoId, accountId) =>
      ipcRenderer.invoke(
        "github:setRepoAccount",
        repoId,
        accountId,
      ) as Promise<RepoInfo | null>,
    startDeviceFlow: () =>
      ipcRenderer.invoke("github:startDeviceFlow") as Promise<DeviceFlowStart>,
    pollDeviceFlow: () =>
      ipcRenderer.invoke("github:pollDeviceFlow") as Promise<DeviceFlowStatus>,
    cancelDeviceFlow: () =>
      ipcRenderer.invoke("github:cancelDeviceFlow") as Promise<void>,
    listPRs: (repoId) =>
      ipcRenderer.invoke("github:listPRs", repoId) as Promise<PRSummary[]>,
    fetchPR: (repoId, prNumber) =>
      ipcRenderer.invoke("github:fetchPR", repoId, prNumber) as Promise<{
        headRef: string;
        baseRef: string;
      }>,
    findPRForBranch: (repoId, branch) =>
      ipcRenderer.invoke(
        "github:findPRForBranch",
        repoId,
        branch,
      ) as Promise<PRSummary | null>,
    getChecks: (repoId, ref) =>
      ipcRenderer.invoke(
        "github:getChecks",
        repoId,
        ref,
      ) as Promise<PRChecksSummary>,
    getPR: (repoId, prNumber) =>
      ipcRenderer.invoke(
        "github:getPR",
        repoId,
        prNumber,
      ) as Promise<PRSummary | null>,
    listReviewComments: (repoId, prNumber) =>
      ipcRenderer.invoke(
        "github:listReviewComments",
        repoId,
        prNumber,
      ) as Promise<PRReviewComment[]>,
    createReviewComment: (repoId, input: NewReviewCommentInput) =>
      ipcRenderer.invoke(
        "github:createReviewComment",
        repoId,
        input,
      ) as Promise<PRReviewComment>,
    replyReviewComment: (repoId, prNumber, commentId, body) =>
      ipcRenderer.invoke(
        "github:replyReviewComment",
        repoId,
        prNumber,
        commentId,
        body,
      ) as Promise<PRReviewComment>,
    deleteReviewComment: (repoId, commentId) =>
      ipcRenderer.invoke(
        "github:deleteReviewComment",
        repoId,
        commentId,
      ) as Promise<void>,
  },
  state: {
    getPrefs: () => ipcRenderer.invoke("state:getPrefs") as Promise<UserPrefs>,
    setPrefs: (patch) =>
      ipcRenderer.invoke("state:setPrefs", patch) as Promise<UserPrefs>,
    getSeenFiles: (repoId, contextKey) =>
      ipcRenderer.invoke("state:getSeenFiles", repoId, contextKey) as Promise<
        string[]
      >,
    setFileSeen: (repoId, contextKey, filePath, seen) =>
      ipcRenderer.invoke(
        "state:setFileSeen",
        repoId,
        contextKey,
        filePath,
        seen,
      ) as Promise<void>,
    clearSeen: (repoId, contextKey) =>
      ipcRenderer.invoke(
        "state:clearSeen",
        repoId,
        contextKey,
      ) as Promise<void>,
    getCollapsedFiles: (repoId, contextKey) =>
      ipcRenderer.invoke(
        "state:getCollapsedFiles",
        repoId,
        contextKey,
      ) as Promise<string[]>,
    setFileCollapsed: (repoId, contextKey, filePath, collapsed) =>
      ipcRenderer.invoke(
        "state:setFileCollapsed",
        repoId,
        contextKey,
        filePath,
        collapsed,
      ) as Promise<void>,
    clearCollapsedFiles: (repoId, contextKey) =>
      ipcRenderer.invoke(
        "state:clearCollapsedFiles",
        repoId,
        contextKey,
      ) as Promise<void>,
    getCommitDraft: (repoId) =>
      ipcRenderer.invoke(
        "state:getCommitDraft",
        repoId,
      ) as Promise<CommitDraft>,
    setCommitDraft: (repoId, draft) =>
      ipcRenderer.invoke(
        "state:setCommitDraft",
        repoId,
        draft,
      ) as Promise<void>,
  },
  shell: {
    openExternal: (url) =>
      ipcRenderer.invoke("shell:openExternal", url) as Promise<void>,
  },
  events: {
    onRepoChanged(handler) {
      const listener = (
        _e: Electron.IpcRendererEvent,
        payload: RepoInfo | null,
      ) => handler(payload);
      ipcRenderer.on("repos:active-changed", listener);
      return () => ipcRenderer.off("repos:active-changed", listener);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
