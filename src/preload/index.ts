import { contextBridge, ipcRenderer } from 'electron';
import type {
  BranchInfo,
  ChangedFile,
  DeviceFlowStart,
  DeviceFlowStatus,
  DiffContext,
  DiffData,
  PRSummary,
  PreloadAPI,
  RepoInfo,
  UserPrefs,
} from '@shared/types.js';

const api: PreloadAPI = {
  repos: {
    list: () => ipcRenderer.invoke('repos:list') as Promise<RepoInfo[]>,
    openPicker: () => ipcRenderer.invoke('repos:openPicker') as Promise<RepoInfo | null>,
    remove: (id) => ipcRenderer.invoke('repos:remove', id) as Promise<void>,
    setActive: (id) => ipcRenderer.invoke('repos:setActive', id) as Promise<RepoInfo | null>,
    getActive: () => ipcRenderer.invoke('repos:getActive') as Promise<RepoInfo | null>,
  },
  git: {
    listBranches: (repoId) =>
      ipcRenderer.invoke('git:listBranches', repoId) as Promise<BranchInfo[]>,
    getCurrentBranch: (repoId) =>
      ipcRenderer.invoke('git:getCurrentBranch', repoId) as Promise<string | null>,
    checkout: (repoId, branch) =>
      ipcRenderer.invoke('git:checkout', repoId, branch) as Promise<void>,
    listChangedFiles: (repoId, ctx: DiffContext) =>
      ipcRenderer.invoke('git:listChangedFiles', repoId, ctx) as Promise<ChangedFile[]>,
    getDiff: (repoId, filePath, ctx: DiffContext) =>
      ipcRenderer.invoke('git:getDiff', repoId, filePath, ctx) as Promise<DiffData>,
  },
  github: {
    isAuthenticated: () => ipcRenderer.invoke('github:isAuthenticated') as Promise<boolean>,
    startDeviceFlow: () =>
      ipcRenderer.invoke('github:startDeviceFlow') as Promise<DeviceFlowStart>,
    pollDeviceFlow: () =>
      ipcRenderer.invoke('github:pollDeviceFlow') as Promise<DeviceFlowStatus>,
    cancelDeviceFlow: () => ipcRenderer.invoke('github:cancelDeviceFlow') as Promise<void>,
    signOut: () => ipcRenderer.invoke('github:signOut') as Promise<void>,
    listPRs: (repoId) => ipcRenderer.invoke('github:listPRs', repoId) as Promise<PRSummary[]>,
    fetchPR: (repoId, prNumber) =>
      ipcRenderer.invoke('github:fetchPR', repoId, prNumber) as Promise<{
        headRef: string;
        baseRef: string;
      }>,
  },
  state: {
    getPrefs: () => ipcRenderer.invoke('state:getPrefs') as Promise<UserPrefs>,
    setPrefs: (patch) => ipcRenderer.invoke('state:setPrefs', patch) as Promise<UserPrefs>,
    getSeenFiles: (repoId, contextKey) =>
      ipcRenderer.invoke('state:getSeenFiles', repoId, contextKey) as Promise<string[]>,
    setFileSeen: (repoId, contextKey, filePath, seen) =>
      ipcRenderer.invoke(
        'state:setFileSeen',
        repoId,
        contextKey,
        filePath,
        seen,
      ) as Promise<void>,
    clearSeen: (repoId, contextKey) =>
      ipcRenderer.invoke('state:clearSeen', repoId, contextKey) as Promise<void>,
  },
  events: {
    onRepoChanged(handler) {
      const listener = (_e: Electron.IpcRendererEvent, payload: RepoInfo | null) =>
        handler(payload);
      ipcRenderer.on('repos:active-changed', listener);
      return () => ipcRenderer.off('repos:active-changed', listener);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
