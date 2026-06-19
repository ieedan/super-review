import { contextBridge, ipcRenderer } from 'electron';
import type {
	BranchContextMenuAction,
	PRContextMenuAction,
	BranchInfo,
	BranchMenuAction,
	BranchMenuState,
	ChangedFile,
	ChangesetStatus,
	CreateChangesetInput,
	CloneResult,
	CreateRepoDefaults,
	CommitDraft,
	CommitFileSelection,
	CommitResult,
	CreateBranchResult,
	DeleteBranchResult,
	DeviceFlowStart,
	DeviceFlowStatus,
	DiffContext,
	DiffData,
	DiffLineContextMenuAction,
	EditorKind,
	FileContextMenuAction,
	HeaderContextMenuResult,
	GithubAccount,
	GithubAuthError,
	GithubOrg,
	LastCommit,
	LocalComment,
	LocalCommentAuthor,
	LocalOnlyBranch,
	NewLocalCommentInput,
	ManagedStash,
	NewReviewCommentInput,
	NpmPackageResult,
	ReleaseNotesResult,
	ReleaseNotesRangeResult,
	PRChecksSummary,
	PRReviewComment,
	PRSummary,
	PreloadAPI,
	PullPushResult,
	PushStatus,
	RepoContextMenuAction,
	RepositoryMenuAction,
	RepositoryMenuState,
	RepoInfo,
	Session,
	SessionSummary,
	TerminalKind,
	UserPrefs
} from '@shared/types.js';

const api: PreloadAPI = {
	platform:
		process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
	repos: {
		list: () => ipcRenderer.invoke('repos:list') as Promise<RepoInfo[]>,
		openPicker: () => ipcRenderer.invoke('repos:openPicker') as Promise<RepoInfo | null>,
		addByPath: (path) => ipcRenderer.invoke('repos:addByPath', path) as Promise<RepoInfo | null>,
		openFolder: () => ipcRenderer.invoke('repos:openFolder') as Promise<RepoInfo[]>,
		chooseDirectory: () => ipcRenderer.invoke('repos:chooseDirectory') as Promise<string | null>,
		isGitRepo: (path) => ipcRenderer.invoke('repos:isGitRepo', path) as Promise<boolean>,
		getCreateDefaults: () =>
			ipcRenderer.invoke('repos:getCreateDefaults') as Promise<CreateRepoDefaults>,
		createRepo: (options) =>
			ipcRenderer.invoke('repos:createRepo', options) as Promise<RepoInfo | null>,
		publish: (repoId, options) =>
			ipcRenderer.invoke('repos:publish', repoId, options) as Promise<RepoInfo>,
		remove: (id, moveToTrash) =>
			ipcRenderer.invoke('repos:remove', id, moveToTrash) as Promise<void>,
		setActive: (id) => ipcRenderer.invoke('repos:setActive', id) as Promise<RepoInfo | null>,
		getActive: () => ipcRenderer.invoke('repos:getActive') as Promise<RepoInfo | null>
	},
	git: {
		listBranches: (repoId) =>
			ipcRenderer.invoke('git:listBranches', repoId) as Promise<BranchInfo[]>,
		listLocalOnlyBranches: (repoId) =>
			ipcRenderer.invoke('git:listLocalOnlyBranches', repoId) as Promise<LocalOnlyBranch[]>,
		getCurrentBranch: (repoId) =>
			ipcRenderer.invoke('git:getCurrentBranch', repoId) as Promise<string | null>,
		checkout: (repoId, branch) =>
			ipcRenderer.invoke('git:checkout', repoId, branch) as Promise<void>,
		checkoutPR: (repoId, pr, source) =>
			ipcRenderer.invoke('git:checkoutPR', repoId, pr, source) as Promise<void>,
		isDirty: (repoId) => ipcRenderer.invoke('git:isDirty', repoId) as Promise<boolean>,
		createBranch: (repoId, name, opts) =>
			ipcRenderer.invoke('git:createBranch', repoId, name, opts) as Promise<CreateBranchResult>,
		deleteBranch: (repoId, name, opts) =>
			ipcRenderer.invoke('git:deleteBranch', repoId, name, opts) as Promise<DeleteBranchResult>,
		listChangedFiles: (repoId, ctx: DiffContext) =>
			ipcRenderer.invoke('git:listChangedFiles', repoId, ctx) as Promise<ChangedFile[]>,
		getDiff: (repoId, filePath, ctx: DiffContext) =>
			ipcRenderer.invoke('git:getDiff', repoId, filePath, ctx) as Promise<DiffData>,
		fetchOrigin: (repoId) =>
			ipcRenderer.invoke('git:fetchOrigin', repoId) as Promise<{
				ok: boolean;
				error?: string;
			}>,
		getPushStatus: (repoId) =>
			ipcRenderer.invoke('git:getPushStatus', repoId) as Promise<PushStatus>,
		pull: (repoId) => ipcRenderer.invoke('git:pull', repoId) as Promise<PullPushResult>,
		push: (repoId) => ipcRenderer.invoke('git:push', repoId) as Promise<PullPushResult>,
		mergeIntoCurrent: (repoId, ref) =>
			ipcRenderer.invoke('git:mergeIntoCurrent', repoId, ref) as Promise<PullPushResult>,
		updateFromUpstream: (repoId, branch) =>
			ipcRenderer.invoke('git:updateFromUpstream', repoId, branch) as Promise<PullPushResult>,
		getConflicts: (repoId) => ipcRenderer.invoke('git:getConflicts', repoId) as Promise<string[]>,
		recheckConflicts: (repoId, files) =>
			ipcRenderer.invoke('git:recheckConflicts', repoId, files) as Promise<string[]>,
		stageFile: (repoId, filePath) =>
			ipcRenderer.invoke('git:stageFile', repoId, filePath) as Promise<void>,
		discardChanges: (repoId, filePath, oldPath) =>
			ipcRenderer.invoke('git:discardChanges', repoId, filePath, oldPath) as Promise<void>,
		discardLines: (repoId, filePath, patch) =>
			ipcRenderer.invoke('git:discardLines', repoId, filePath, patch) as Promise<void>,
		continueMerge: (repoId) =>
			ipcRenderer.invoke('git:continueMerge', repoId) as Promise<PullPushResult>,
		abortMerge: (repoId) => ipcRenderer.invoke('git:abortMerge', repoId) as Promise<void>,
		createManagedStash: (repoId) =>
			ipcRenderer.invoke('git:createManagedStash', repoId) as Promise<{
				ok: boolean;
				error?: string;
			}>,
		findManagedStash: (repoId) =>
			ipcRenderer.invoke('git:findManagedStash', repoId) as Promise<ManagedStash | null>,
		restoreManagedStash: (repoId, ref) =>
			ipcRenderer.invoke('git:restoreManagedStash', repoId, ref) as Promise<PullPushResult>,
		discardManagedStash: (repoId, ref) =>
			ipcRenderer.invoke('git:discardManagedStash', repoId, ref) as Promise<void>,
		finishStashPop: (repoId, ref) =>
			ipcRenderer.invoke('git:finishStashPop', repoId, ref) as Promise<PullPushResult>,
		abortStashPop: (repoId) => ipcRenderer.invoke('git:abortStashPop', repoId) as Promise<void>,
		commit: (repoId, message, files: CommitFileSelection[]) =>
			ipcRenderer.invoke('git:commit', repoId, message, files) as Promise<CommitResult>,
		getLastCommit: (repoId) =>
			ipcRenderer.invoke('git:getLastCommit', repoId) as Promise<LastCommit | null>,
		undoLastCommit: (repoId) =>
			ipcRenderer.invoke('git:undoLastCommit', repoId) as Promise<CommitResult>,
		cloneRepo: (url) => ipcRenderer.invoke('git:cloneRepo', url) as Promise<CloneResult>,
		convertToFork: (repoId, forkOwner, forkRepo, contributeToParent) =>
			ipcRenderer.invoke(
				'git:convertToFork',
				repoId,
				forkOwner,
				forkRepo,
				contributeToParent
			) as Promise<RepoInfo>,
		setForkContribution: (repoId, contributeToParent) =>
			ipcRenderer.invoke('git:setForkContribution', repoId, contributeToParent) as Promise<RepoInfo>
	},
	changesets: {
		getStatus: (repoId) =>
			ipcRenderer.invoke('changesets:getStatus', repoId) as Promise<ChangesetStatus>,
		create: (repoId, input: CreateChangesetInput) =>
			ipcRenderer.invoke('changesets:create', repoId, input) as Promise<string>,
		remove: (repoId, path: string) =>
			ipcRenderer.invoke('changesets:remove', repoId, path) as Promise<void>
	},
	editor: {
		detect: () => ipcRenderer.invoke('editor:detect') as Promise<Record<EditorKind, boolean>>,
		open: (editor: EditorKind, target: string) =>
			ipcRenderer.invoke('editor:open', editor, target) as Promise<{
				ok: boolean;
				error?: string;
			}>
	},
	terminal: {
		detect: () => ipcRenderer.invoke('terminal:detect') as Promise<Record<TerminalKind, boolean>>,
		open: (terminal: TerminalKind, target: string) =>
			ipcRenderer.invoke('terminal:open', terminal, target) as Promise<{
				ok: boolean;
				error?: string;
			}>
	},
	github: {
		listAccounts: () => ipcRenderer.invoke('github:listAccounts') as Promise<GithubAccount[]>,
		listOrganizations: (repoId) =>
			ipcRenderer.invoke('github:listOrganizations', repoId) as Promise<GithubOrg[]>,
		getActiveAccount: () =>
			ipcRenderer.invoke('github:getActiveAccount') as Promise<GithubAccount | null>,
		setActiveAccount: (id) =>
			ipcRenderer.invoke('github:setActiveAccount', id) as Promise<GithubAccount | null>,
		removeAccount: (id) => ipcRenderer.invoke('github:removeAccount', id) as Promise<void>,
		setRepoAccount: (repoId, accountId) =>
			ipcRenderer.invoke('github:setRepoAccount', repoId, accountId) as Promise<RepoInfo | null>,
		startDeviceFlow: () => ipcRenderer.invoke('github:startDeviceFlow') as Promise<DeviceFlowStart>,
		pollDeviceFlow: () => ipcRenderer.invoke('github:pollDeviceFlow') as Promise<DeviceFlowStatus>,
		cancelDeviceFlow: () => ipcRenderer.invoke('github:cancelDeviceFlow') as Promise<void>,
		listPRs: (repoId, page, source) =>
			ipcRenderer.invoke('github:listPRs', repoId, page, source) as Promise<PRSummary[]>,
		detectUpstream: (repoId) =>
			ipcRenderer.invoke('github:detectUpstream', repoId) as Promise<RepoInfo | null>,
		getRepoPushAccess: (repoId) =>
			ipcRenderer.invoke('github:getRepoPushAccess', repoId) as Promise<boolean | null>,
		createFork: (repoId) =>
			ipcRenderer.invoke('github:createFork', repoId) as Promise<{ owner: string; repo: string }>,
		getRepoParent: (repoId) =>
			ipcRenderer.invoke('github:getRepoParent', repoId) as Promise<{
				owner: string;
				repo: string;
			} | null>,
		fetchPR: (repoId, prNumber, owner, repo) =>
			ipcRenderer.invoke('github:fetchPR', repoId, prNumber, owner, repo) as Promise<{
				headRef: string;
				baseRef: string;
			}>,
		findPRForBranch: (repoId, branch) =>
			ipcRenderer.invoke('github:findPRForBranch', repoId, branch) as Promise<PRSummary | null>,
		canPushToPR: (repoId, pr) =>
			ipcRenderer.invoke('github:canPushToPR', repoId, pr) as Promise<boolean | null>,
		getChecks: (repoId, ref, owner, repo) =>
			ipcRenderer.invoke('github:getChecks', repoId, ref, owner, repo) as Promise<PRChecksSummary>,
		getPR: (repoId, prNumber, owner, repo) =>
			ipcRenderer.invoke(
				'github:getPR',
				repoId,
				prNumber,
				owner,
				repo
			) as Promise<PRSummary | null>,
		listReviewComments: (repoId, prNumber, owner, repo) =>
			ipcRenderer.invoke('github:listReviewComments', repoId, prNumber, owner, repo) as Promise<
				PRReviewComment[]
			>,
		createReviewComment: (repoId, input: NewReviewCommentInput, owner, repo) =>
			ipcRenderer.invoke(
				'github:createReviewComment',
				repoId,
				input,
				owner,
				repo
			) as Promise<PRReviewComment>,
		replyReviewComment: (repoId, prNumber, commentId, body, owner, repo) =>
			ipcRenderer.invoke(
				'github:replyReviewComment',
				repoId,
				prNumber,
				commentId,
				body,
				owner,
				repo
			) as Promise<PRReviewComment>,
		deleteReviewComment: (repoId, commentId, owner, repo) =>
			ipcRenderer.invoke(
				'github:deleteReviewComment',
				repoId,
				commentId,
				owner,
				repo
			) as Promise<void>,
		setReviewThreadResolved: (repoId, threadId, resolved) =>
			ipcRenderer.invoke('github:setReviewThreadResolved', repoId, threadId, resolved) as Promise<{
				isResolved: boolean;
			}>,
		getAuthErrors: () => ipcRenderer.invoke('github:getAuthErrors') as Promise<GithubAuthError[]>,
		validateAccounts: () =>
			ipcRenderer.invoke('github:validateAccounts') as Promise<GithubAuthError[]>
	},
	state: {
		getPrefs: () => ipcRenderer.invoke('state:getPrefs') as Promise<UserPrefs>,
		setPrefs: (patch) => ipcRenderer.invoke('state:setPrefs', patch) as Promise<UserPrefs>,
		getSeenFiles: (repoId, contextKey) =>
			ipcRenderer.invoke('state:getSeenFiles', repoId, contextKey) as Promise<string[]>,
		getSeenSignatures: (repoId, contextKey) =>
			ipcRenderer.invoke('state:getSeenSignatures', repoId, contextKey) as Promise<
				Record<string, string>
			>,
		setFileSeen: (repoId, contextKey, filePath, seen, sig) =>
			ipcRenderer.invoke(
				'state:setFileSeen',
				repoId,
				contextKey,
				filePath,
				seen,
				sig
			) as Promise<void>,
		clearSeen: (repoId, contextKey) =>
			ipcRenderer.invoke('state:clearSeen', repoId, contextKey) as Promise<void>,
		getCollapsedFiles: (repoId, contextKey) =>
			ipcRenderer.invoke('state:getCollapsedFiles', repoId, contextKey) as Promise<string[]>,
		setFileCollapsed: (repoId, contextKey, filePath, collapsed) =>
			ipcRenderer.invoke(
				'state:setFileCollapsed',
				repoId,
				contextKey,
				filePath,
				collapsed
			) as Promise<void>,
		clearCollapsedFiles: (repoId, contextKey) =>
			ipcRenderer.invoke('state:clearCollapsedFiles', repoId, contextKey) as Promise<void>,
		getCommitDraft: (repoId) =>
			ipcRenderer.invoke('state:getCommitDraft', repoId) as Promise<CommitDraft>,
		setCommitDraft: (repoId, draft) =>
			ipcRenderer.invoke('state:setCommitDraft', repoId, draft) as Promise<void>
	},
	sessions: {
		list: (repoId, ref) =>
			ipcRenderer.invoke('sessions:list', repoId, ref) as Promise<SessionSummary[]>,
		get: (repoId, id, ref) =>
			ipcRenderer.invoke('sessions:get', repoId, id, ref) as Promise<Session | null>,
		remove: (repoId, id) => ipcRenderer.invoke('sessions:remove', repoId, id) as Promise<void>,
		clear: (repoId) => ipcRenderer.invoke('sessions:clear', repoId) as Promise<void>,
		count: (repoId, ref) => ipcRenderer.invoke('sessions:count', repoId, ref) as Promise<number>,
		watch: (repoId) => ipcRenderer.invoke('sessions:watch', repoId) as Promise<void>,
		unwatch: () => ipcRenderer.invoke('sessions:unwatch') as Promise<void>
	},
	comments: {
		list: (repoId, contextKey) =>
			ipcRenderer.invoke('comments:list', repoId, contextKey) as Promise<LocalComment[]>,
		add: (repoId, input: NewLocalCommentInput) =>
			ipcRenderer.invoke('comments:add', repoId, input) as Promise<LocalComment>,
		resolve: (repoId, id, resolver: LocalCommentAuthor, sessionId) =>
			ipcRenderer.invoke(
				'comments:resolve',
				repoId,
				id,
				resolver,
				sessionId
			) as Promise<LocalComment | null>,
		unresolve: (repoId, id) =>
			ipcRenderer.invoke('comments:unresolve', repoId, id) as Promise<LocalComment | null>,
		remove: (repoId, id) => ipcRenderer.invoke('comments:remove', repoId, id) as Promise<void>,
		watch: (repoId) => ipcRenderer.invoke('comments:watch', repoId) as Promise<void>,
		unwatch: () => ipcRenderer.invoke('comments:unwatch') as Promise<void>
	},
	skill: {
		isInstalled: (repoId) => ipcRenderer.invoke('skill:isInstalled', repoId) as Promise<boolean>,
		install: (repoId) => ipcRenderer.invoke('skill:install', repoId) as Promise<void>
	},
	npm: {
		getPackageInfo: (name) =>
			ipcRenderer.invoke('npm:getPackageInfo', name) as Promise<NpmPackageResult>,
		getReleaseNotes: (repositoryUrl, packageName, version) =>
			ipcRenderer.invoke(
				'npm:getReleaseNotes',
				repositoryUrl,
				packageName,
				version
			) as Promise<ReleaseNotesResult>,
		getReleaseNotesRange: (repositoryUrl, packageName, fromVersion, toVersion) =>
			ipcRenderer.invoke(
				'npm:getReleaseNotesRange',
				repositoryUrl,
				packageName,
				fromVersion,
				toVersion
			) as Promise<ReleaseNotesRangeResult>
	},
	shell: {
		openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url) as Promise<void>,
		showItemInFolder: (fullPath) =>
			ipcRenderer.invoke('shell:showItemInFolder', fullPath) as Promise<void>,
		openPath: (fullPath) =>
			ipcRenderer.invoke('shell:openPath', fullPath) as Promise<{
				ok: boolean;
				error?: string;
			}>
	},
	menu: {
		showFileContextMenu: (params) =>
			ipcRenderer.invoke(
				'menu:showFileContextMenu',
				params
			) as Promise<FileContextMenuAction | null>,
		showDiffLineContextMenu: (params) =>
			ipcRenderer.invoke(
				'menu:showDiffLineContextMenu',
				params
			) as Promise<DiffLineContextMenuAction | null>,
		showBranchContextMenu: (params) =>
			ipcRenderer.invoke(
				'menu:showBranchContextMenu',
				params
			) as Promise<BranchContextMenuAction | null>,
		showPRContextMenu: (params) =>
			ipcRenderer.invoke('menu:showPRContextMenu', params) as Promise<PRContextMenuAction | null>,
		showRepoContextMenu: (params) =>
			ipcRenderer.invoke(
				'menu:showRepoContextMenu',
				params
			) as Promise<RepoContextMenuAction | null>,
		showHeaderContextMenu: (params) =>
			ipcRenderer.invoke('menu:showHeaderContextMenu', params) as Promise<HeaderContextMenuResult>,
		setBranchState: (state: BranchMenuState) => ipcRenderer.send('menu:setBranchState', state),
		setRepositoryState: (state: RepositoryMenuState) =>
			ipcRenderer.send('menu:setRepositoryState', state)
	},
	windowControls: {
		// Ask the main process to re-center the macOS traffic lights for the
		// current zoom factor. The renderer fires this on zoom changes (which the
		// main 'zoom-changed' event misses for keyboard/menu zoom).
		sync: () => ipcRenderer.send('window:syncControls')
	},
	events: {
		onRepoChanged(handler) {
			const listener = (_e: Electron.IpcRendererEvent, payload: RepoInfo | null) =>
				handler(payload);
			ipcRenderer.on('repos:active-changed', listener);
			return () => ipcRenderer.off('repos:active-changed', listener);
		},
		onBranchMenuAction(handler) {
			const listener = (_e: Electron.IpcRendererEvent, action: BranchMenuAction) => handler(action);
			ipcRenderer.on('menu:branch-action', listener);
			return () => ipcRenderer.off('menu:branch-action', listener);
		},
		onRepositoryMenuAction(handler) {
			const listener = (_e: Electron.IpcRendererEvent, action: RepositoryMenuAction) =>
				handler(action);
			ipcRenderer.on('menu:repository-action', listener);
			return () => ipcRenderer.off('menu:repository-action', listener);
		},
		onRepoTrashFailed(handler) {
			const listener = (_e: Electron.IpcRendererEvent, name: string) => handler(name);
			ipcRenderer.on('repos:trash-failed', listener);
			return () => ipcRenderer.off('repos:trash-failed', listener);
		},
		onSessionsChanged(handler) {
			const listener = (_e: Electron.IpcRendererEvent, repoId: string) => handler(repoId);
			ipcRenderer.on('sessions:changed', listener);
			return () => ipcRenderer.off('sessions:changed', listener);
		},
		onCommentsChanged(handler) {
			const listener = (_e: Electron.IpcRendererEvent, repoId: string) => handler(repoId);
			ipcRenderer.on('comments:changed', listener);
			return () => ipcRenderer.off('comments:changed', listener);
		},
		onGithubAuthChanged(handler) {
			const listener = (_e: Electron.IpcRendererEvent, errors: GithubAuthError[]) =>
				handler(errors);
			ipcRenderer.on('github:auth-changed', listener);
			return () => ipcRenderer.off('github:auth-changed', listener);
		}
	}
};

contextBridge.exposeInMainWorld('api', api);
