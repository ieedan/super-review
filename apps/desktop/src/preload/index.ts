import { contextBridge, ipcRenderer } from 'electron';
import type {
	BranchContextMenuAction,
	CommitContextMenuAction,
	PRContextMenuAction,
	BranchInfo,
	BranchMenuAction,
	BranchMenuState,
	ChangedFile,
	ChangesetStatus,
	CreateChangesetInput,
	CloneResult,
	CreateRepoDefaults,
	RemoteRepoRef,
	CommitAuthorIdentity,
	CommitDraft,
	CommitInfo,
	CommitFileSelection,
	CommitResult,
	ActivationStatus,
	CreateBranchResult,
	DeleteBranchResult,
	DeviceFlowStart,
	DeviceFlowStatus,
	DiffContext,
	DiffData,
	LicenseState,
	DiffLineContextMenuAction,
	EditorKind,
	FeedbackInput,
	FeedbackResult,
	FileContextMenuResult,
	HeaderContextMenuResult,
	EmptyViewContextMenuResult,
	FileHeaderContextMenuResult,
	HelpMenuAction,
	GithubAccount,
	GithubAuthError,
	GithubOrg,
	IssueReference,
	LastCommit,
	LocalComment,
	LocalCommentAuthor,
	MentionableUser,
	LocalOnlyBranch,
	NewLocalCommentInput,
	PrefsChange,
	ManagedStash,
	NewReviewCommentInput,
	NpmPackageResult,
	ReleaseNotesResult,
	ReleaseNotesRangeResult,
	PRChecksSummary,
	PRConversationItem,
	PRMergeResult,
	PRReviewComment,
	PRSummary,
	PreloadAPI,
	PullPushResult,
	PushStatus,
	RepoContextMenuAction,
	RepositoryMenuAction,
	RepositoryMenuState,
	RepoInfo,
	RepoUsageStats,
	Session,
	SessionSummary,
	Task,
	NewTaskInput,
	TaskPatch,
	TaskActor,
	TaskContextMenuAction,
	AiConfigStatus,
	AiConfigApplyResult,
	AiConfigRemoveResult,
	TabsContextMenuResult,
	SidebarControlsContextMenuResult,
	TerminalKind,
	UpdateStatus,
	UserPrefs,
	WindowChromeAction
} from '@shared/types.js';
import { isLicenseAllowedChannel, LicenseGateError } from '@shared/license-ipc.js';

// Live mirror of main-process unlock state. Seeded before the API is exposed and
// kept in sync via license:changed + license status invokes so gated invokes
// never hit main while locked (avoids Electron's "Error invoking remote
// method..." wrapper).
let unlocked = false;

function applyLicenseState(state: LicenseState): void {
	unlocked = state.state === 'licensed';
}

ipcRenderer.on('license:changed', (_e, state: LicenseState) => {
	applyLicenseState(state);
});

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
	if (!isLicenseAllowedChannel(channel) && !unlocked) {
		return Promise.reject(new LicenseGateError());
	}
	const result = ipcRenderer.invoke(channel, ...args);
	// Keep the unlock flag in lockstep with any license status the renderer
	// fetches, so LicensedApp's first gated calls aren't soft-rejected while
	// the fire-and-forget seed is still in flight.
	if (channel === 'license:getStatus' || channel === 'license:recheck') {
		return result.then((state) => {
			applyLicenseState(state as LicenseState);
			return state;
		});
	}
	if (channel === 'license:pollActivation') {
		return result.then((status) => {
			const s = status as ActivationStatus;
			if (s.state === 'success') applyLicenseState(s.license);
			return status;
		});
	}
	if (channel === 'license:signOut') {
		return result.then((value) => {
			unlocked = false;
			return value;
		});
	}
	return result;
}

// Fire-and-forget seed; license:* is always allowed. Until this lands, unlocked
// stays false so any early gated invoke soft-rejects instead of racing main.
void ipcRenderer.invoke('license:getStatus').then((state: LicenseState) => {
	applyLicenseState(state);
});

const api: PreloadAPI = {
	platform:
		process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
	license: {
		getStatus: () => invoke('license:getStatus') as Promise<LicenseState>,
		startActivation: () =>
			invoke('license:startActivation') as Promise<{
				userCode: string;
				verificationUri: string;
			}>,
		pollActivation: () => invoke('license:pollActivation') as Promise<ActivationStatus>,
		cancelActivation: () => invoke('license:cancelActivation') as Promise<void>,
		openVerification: () => invoke('license:openVerification') as Promise<void>,
		recheck: () => invoke('license:recheck') as Promise<LicenseState>,
		signOut: () => invoke('license:signOut') as Promise<void>,
		openPricing: () => invoke('license:openPricing') as Promise<void>,
		openDashboard: () => invoke('license:openDashboard') as Promise<void>
	},
	updater: {
		getVersion: () => invoke('updater:getVersion') as Promise<string>,
		getStatus: () => invoke('updater:getStatus') as Promise<UpdateStatus>,
		check: () => invoke('updater:check') as Promise<void>,
		quitAndInstall: () => {
			void invoke('updater:quitAndInstall');
		}
	},
	repos: {
		list: () => invoke('repos:list') as Promise<RepoInfo[]>,
		openPicker: () => invoke('repos:openPicker') as Promise<RepoInfo | null>,
		addByPath: (path) => invoke('repos:addByPath', path) as Promise<RepoInfo | null>,
		openFolder: () => invoke('repos:openFolder') as Promise<RepoInfo[]>,
		chooseDirectory: () => invoke('repos:chooseDirectory') as Promise<string | null>,
		isGitRepo: (path) => invoke('repos:isGitRepo', path) as Promise<boolean>,
		getCreateDefaults: () => invoke('repos:getCreateDefaults') as Promise<CreateRepoDefaults>,
		checkRemoteRepo: (name, accountId, owner) =>
			invoke('repos:checkRemoteRepo', name, accountId, owner) as Promise<RemoteRepoRef | null>,
		createRepo: (options) => invoke('repos:createRepo', options) as Promise<RepoInfo | null>,
		publish: (repoId, options) => invoke('repos:publish', repoId, options) as Promise<RepoInfo>,
		remove: (id, moveToTrash) => invoke('repos:remove', id, moveToTrash) as Promise<void>,
		setActive: (id) => invoke('repos:setActive', id) as Promise<RepoInfo | null>,
		getActive: () => invoke('repos:getActive') as Promise<RepoInfo | null>
	},
	git: {
		listBranches: (repoId) => invoke('git:listBranches', repoId) as Promise<BranchInfo[]>,
		listLocalOnlyBranches: (repoId) =>
			invoke('git:listLocalOnlyBranches', repoId) as Promise<LocalOnlyBranch[]>,
		getCurrentBranch: (repoId) => invoke('git:getCurrentBranch', repoId) as Promise<string | null>,
		checkout: (repoId, branch) => invoke('git:checkout', repoId, branch) as Promise<void>,
		checkoutPR: (repoId, pr, source) =>
			invoke('git:checkoutPR', repoId, pr, source) as Promise<void>,
		isDirty: (repoId) => invoke('git:isDirty', repoId) as Promise<boolean>,
		createBranch: (repoId, name, opts) =>
			invoke('git:createBranch', repoId, name, opts) as Promise<CreateBranchResult>,
		deleteBranch: (repoId, name, opts) =>
			invoke('git:deleteBranch', repoId, name, opts) as Promise<DeleteBranchResult>,
		listChangedFiles: (repoId, ctx: DiffContext) =>
			invoke('git:listChangedFiles', repoId, ctx) as Promise<ChangedFile[]>,
		refExists: (repoId, ref) => invoke('git:refExists', repoId, ref) as Promise<boolean>,
		getDiff: (repoId, filePath, ctx: DiffContext) =>
			invoke('git:getDiff', repoId, filePath, ctx) as Promise<DiffData>,
		fetchOrigin: (repoId) =>
			invoke('git:fetchOrigin', repoId) as Promise<{
				ok: boolean;
				error?: string;
			}>,
		getPushStatus: (repoId) => invoke('git:getPushStatus', repoId) as Promise<PushStatus>,
		pull: (repoId) => invoke('git:pull', repoId) as Promise<PullPushResult>,
		push: (repoId) => invoke('git:push', repoId) as Promise<PullPushResult>,
		mergeIntoCurrent: (repoId, ref) =>
			invoke('git:mergeIntoCurrent', repoId, ref) as Promise<PullPushResult>,
		updateFromUpstream: (repoId, branch) =>
			invoke('git:updateFromUpstream', repoId, branch) as Promise<PullPushResult>,
		getConflicts: (repoId) => invoke('git:getConflicts', repoId) as Promise<string[]>,
		recheckConflicts: (repoId, files) =>
			invoke('git:recheckConflicts', repoId, files) as Promise<string[]>,
		stageFile: (repoId, filePath) => invoke('git:stageFile', repoId, filePath) as Promise<void>,
		discardChanges: (repoId, filePath, oldPath) =>
			invoke('git:discardChanges', repoId, filePath, oldPath) as Promise<void>,
		discardFiles: (repoId, files) => invoke('git:discardFiles', repoId, files) as Promise<void>,
		discardLines: (repoId, filePath, patch) =>
			invoke('git:discardLines', repoId, filePath, patch) as Promise<void>,
		addToGitignore: (repoId, patterns) =>
			invoke('git:addToGitignore', repoId, patterns) as Promise<void>,
		continueMerge: (repoId) => invoke('git:continueMerge', repoId) as Promise<PullPushResult>,
		abortMerge: (repoId) => invoke('git:abortMerge', repoId) as Promise<void>,
		createManagedStash: (repoId) =>
			invoke('git:createManagedStash', repoId) as Promise<{
				ok: boolean;
				error?: string;
			}>,
		findManagedStash: (repoId) =>
			invoke('git:findManagedStash', repoId) as Promise<ManagedStash | null>,
		restoreManagedStash: (repoId, ref) =>
			invoke('git:restoreManagedStash', repoId, ref) as Promise<PullPushResult>,
		restoreManagedStashKeepingLocal: (repoId, ref) =>
			invoke('git:restoreManagedStashKeepingLocal', repoId, ref) as Promise<PullPushResult>,
		discardManagedStash: (repoId, ref) =>
			invoke('git:discardManagedStash', repoId, ref) as Promise<void>,
		finishStashPop: (repoId, ref) =>
			invoke('git:finishStashPop', repoId, ref) as Promise<PullPushResult>,
		abortStashPop: (repoId) => invoke('git:abortStashPop', repoId) as Promise<void>,
		commit: (repoId, message, files: CommitFileSelection[]) =>
			invoke('git:commit', repoId, message, files) as Promise<CommitResult>,
		getLastCommit: (repoId) => invoke('git:getLastCommit', repoId) as Promise<LastCommit | null>,
		listCommits: (repoId, head, limit) =>
			invoke('git:listCommits', repoId, head, limit) as Promise<CommitInfo[]>,
		mergeBase: (repoId, a, b) => invoke('git:mergeBase', repoId, a, b) as Promise<string | null>,
		undoLastCommit: (repoId) => invoke('git:undoLastCommit', repoId) as Promise<CommitResult>,
		cloneRepo: (url) => invoke('git:cloneRepo', url) as Promise<CloneResult>,
		convertToFork: (repoId, forkOwner, forkRepo, contributeToParent) =>
			invoke(
				'git:convertToFork',
				repoId,
				forkOwner,
				forkRepo,
				contributeToParent
			) as Promise<RepoInfo>,
		setForkContribution: (repoId, contributeToParent) =>
			invoke('git:setForkContribution', repoId, contributeToParent) as Promise<RepoInfo>
	},
	changesets: {
		getStatus: (repoId) => invoke('changesets:getStatus', repoId) as Promise<ChangesetStatus>,
		create: (repoId, input: CreateChangesetInput) =>
			invoke('changesets:create', repoId, input) as Promise<string>,
		remove: (repoId, path: string) => invoke('changesets:remove', repoId, path) as Promise<void>
	},
	editor: {
		detect: () => invoke('editor:detect') as Promise<Record<EditorKind, boolean>>,
		open: (editor: EditorKind, target: string, line?: number) =>
			invoke('editor:open', editor, target, line) as Promise<{
				ok: boolean;
				error?: string;
			}>
	},
	terminal: {
		detect: () => invoke('terminal:detect') as Promise<Record<TerminalKind, boolean>>,
		open: (terminal: TerminalKind, target: string) =>
			invoke('terminal:open', terminal, target) as Promise<{
				ok: boolean;
				error?: string;
			}>
	},
	github: {
		listAccounts: () => invoke('github:listAccounts') as Promise<GithubAccount[]>,
		listOrganizations: (repoId) =>
			invoke('github:listOrganizations', repoId) as Promise<GithubOrg[]>,
		listAccountOrganizations: (accountId) =>
			invoke('github:listAccountOrganizations', accountId) as Promise<GithubOrg[]>,
		getActiveAccount: () => invoke('github:getActiveAccount') as Promise<GithubAccount | null>,
		setActiveAccount: (id) =>
			invoke('github:setActiveAccount', id) as Promise<GithubAccount | null>,
		removeAccount: (id) => invoke('github:removeAccount', id) as Promise<void>,
		setRepoAccount: (repoId, accountId) =>
			invoke('github:setRepoAccount', repoId, accountId) as Promise<RepoInfo | null>,
		startDeviceFlow: () => invoke('github:startDeviceFlow') as Promise<DeviceFlowStart>,
		pollDeviceFlow: () => invoke('github:pollDeviceFlow') as Promise<DeviceFlowStatus>,
		cancelDeviceFlow: () => invoke('github:cancelDeviceFlow') as Promise<void>,
		listPRs: (repoId, page, source) =>
			invoke('github:listPRs', repoId, page, source) as Promise<PRSummary[]>,
		listMentionableUsers: (repoId) =>
			invoke('github:listMentionableUsers', repoId) as Promise<MentionableUser[]>,
		listIssueReferences: (repoId, query) =>
			invoke('github:listIssueReferences', repoId, query) as Promise<IssueReference[]>,
		resolveCommitAuthors: (repoId, candidates) =>
			invoke('github:resolveCommitAuthors', repoId, candidates) as Promise<
				Record<string, CommitAuthorIdentity>
			>,
		detectUpstream: (repoId) => invoke('github:detectUpstream', repoId) as Promise<RepoInfo | null>,
		getRepoPushAccess: (repoId) =>
			invoke('github:getRepoPushAccess', repoId) as Promise<boolean | null>,
		createFork: (repoId) =>
			invoke('github:createFork', repoId) as Promise<{ owner: string; repo: string }>,
		getRepoParent: (repoId) =>
			invoke('github:getRepoParent', repoId) as Promise<{
				owner: string;
				repo: string;
			} | null>,
		fetchPR: (repoId, prNumber, owner, repo) =>
			invoke('github:fetchPR', repoId, prNumber, owner, repo) as Promise<{
				headRef: string;
				baseRef: string;
			}>,
		findPRForBranch: (repoId, branch) =>
			invoke('github:findPRForBranch', repoId, branch) as Promise<PRSummary | null>,
		canPushToPR: (repoId, pr) =>
			invoke('github:canPushToPR', repoId, pr) as Promise<boolean | null>,
		getChecks: (repoId, ref, owner, repo) =>
			invoke('github:getChecks', repoId, ref, owner, repo) as Promise<PRChecksSummary>,
		getPR: (repoId, prNumber, owner, repo) =>
			invoke('github:getPR', repoId, prNumber, owner, repo) as Promise<PRSummary | null>,
		listReviewComments: (repoId, prNumber, owner, repo) =>
			invoke('github:listReviewComments', repoId, prNumber, owner, repo) as Promise<
				PRReviewComment[]
			>,
		createReviewComment: (repoId, input: NewReviewCommentInput, owner, repo) =>
			invoke('github:createReviewComment', repoId, input, owner, repo) as Promise<PRReviewComment>,
		replyReviewComment: (repoId, prNumber, commentId, body, owner, repo) =>
			invoke(
				'github:replyReviewComment',
				repoId,
				prNumber,
				commentId,
				body,
				owner,
				repo
			) as Promise<PRReviewComment>,
		deleteReviewComment: (repoId, commentId, owner, repo) =>
			invoke('github:deleteReviewComment', repoId, commentId, owner, repo) as Promise<void>,
		updateReviewComment: (repoId, commentId, body, owner, repo) =>
			invoke('github:updateReviewComment', repoId, commentId, body, owner, repo) as Promise<string>,
		setReviewThreadResolved: (repoId, threadId, resolved) =>
			invoke('github:setReviewThreadResolved', repoId, threadId, resolved) as Promise<{
				isResolved: boolean;
			}>,
		listConversation: (repoId, prNumber, owner, repo) =>
			invoke('github:listConversation', repoId, prNumber, owner, repo) as Promise<
				PRConversationItem[]
			>,
		createIssueComment: (repoId, prNumber, body, owner, repo) =>
			invoke(
				'github:createIssueComment',
				repoId,
				prNumber,
				body,
				owner,
				repo
			) as Promise<PRConversationItem>,
		deleteIssueComment: (repoId, commentId, owner, repo) =>
			invoke('github:deleteIssueComment', repoId, commentId, owner, repo) as Promise<void>,
		updateIssueComment: (repoId, commentId, body, owner, repo) =>
			invoke('github:updateIssueComment', repoId, commentId, body, owner, repo) as Promise<string>,
		updatePullRequestBody: (repoId, prNumber, body, owner, repo) =>
			invoke(
				'github:updatePullRequestBody',
				repoId,
				prNumber,
				body,
				owner,
				repo
			) as Promise<string>,
		mergePullRequest: (repoId, prNumber, method, owner, repo, commitTitle, commitMessage) =>
			invoke(
				'github:mergePullRequest',
				repoId,
				prNumber,
				method,
				owner,
				repo,
				commitTitle,
				commitMessage
			) as Promise<PRMergeResult>,
		markPullRequestReady: (repoId, prNumber, owner, repo) =>
			invoke('github:markPullRequestReady', repoId, prNumber, owner, repo) as Promise<void>,
		getAuthErrors: () => invoke('github:getAuthErrors') as Promise<GithubAuthError[]>,
		validateAccounts: () => invoke('github:validateAccounts') as Promise<GithubAuthError[]>
	},
	state: {
		getPrefs: () => invoke('state:getPrefs') as Promise<UserPrefs>,
		setPrefs: (patch) => invoke('state:setPrefs', patch) as Promise<UserPrefs>,
		getSeenFiles: (repoId, contextKey) =>
			invoke('state:getSeenFiles', repoId, contextKey) as Promise<string[]>,
		getSeenSignatures: (repoId, contextKey) =>
			invoke('state:getSeenSignatures', repoId, contextKey) as Promise<Record<string, string>>,
		getInheritedSeen: (repoId, contextKey, fileDiffSigs) =>
			invoke('state:getInheritedSeen', repoId, contextKey, fileDiffSigs) as Promise<string[]>,
		getRetainedSeen: (repoId, contextKey, fileDiffSigs) =>
			invoke('state:getRetainedSeen', repoId, contextKey, fileDiffSigs) as Promise<string[]>,
		setFileSeen: (repoId, contextKey, filePath, seen, sig) =>
			invoke('state:setFileSeen', repoId, contextKey, filePath, seen, sig) as Promise<void>,
		clearSeen: (repoId, contextKey) =>
			invoke('state:clearSeen', repoId, contextKey) as Promise<void>,
		getCollapsedFiles: (repoId, contextKey) =>
			invoke('state:getCollapsedFiles', repoId, contextKey) as Promise<string[]>,
		setFileCollapsed: (repoId, contextKey, filePath, collapsed) =>
			invoke('state:setFileCollapsed', repoId, contextKey, filePath, collapsed) as Promise<void>,
		setFilesCollapsed: (repoId, contextKey, filePaths, collapsed) =>
			invoke('state:setFilesCollapsed', repoId, contextKey, filePaths, collapsed) as Promise<void>,
		clearCollapsedFiles: (repoId, contextKey) =>
			invoke('state:clearCollapsedFiles', repoId, contextKey) as Promise<void>,
		getCachedFileList: (repoId, contextKey) =>
			invoke('state:getCachedFileList', repoId, contextKey) as Promise<ChangedFile[]>,
		setCachedFileList: (repoId, contextKey, files) =>
			invoke('state:setCachedFileList', repoId, contextKey, files) as Promise<void>,
		getBranchBase: (repoId, branch) =>
			invoke('state:getBranchBase', repoId, branch) as Promise<string | null>,
		setBranchBase: (repoId, branch, base) =>
			invoke('state:setBranchBase', repoId, branch, base) as Promise<void>,
		getCommitDraft: (repoId) => invoke('state:getCommitDraft', repoId) as Promise<CommitDraft>,
		setCommitDraft: (repoId, draft) =>
			invoke('state:setCommitDraft', repoId, draft) as Promise<void>
	},
	stats: {
		get: (repoId) => invoke('stats:get', repoId) as Promise<RepoUsageStats>,
		getAll: () => invoke('stats:getAll') as Promise<Record<string, RepoUsageStats>>,
		recordFileReviewed: (repoId, sig, loc) =>
			invoke('stats:recordFileReviewed', repoId, sig, loc) as Promise<void>,
		recordSessionReviewed: (repoId, sessionId) =>
			invoke('stats:recordSessionReviewed', repoId, sessionId) as Promise<void>
	},
	icons: {
		resolveCustomIcon: (source) =>
			invoke('icons:resolveCustomIcon', source) as Promise<string | null>,
		pickIconFile: () => invoke('icons:pickIconFile') as Promise<string | null>
	},
	sessions: {
		list: (repoId, ref) => invoke('sessions:list', repoId, ref) as Promise<SessionSummary[]>,
		get: (repoId, id, ref) => invoke('sessions:get', repoId, id, ref) as Promise<Session | null>,
		remove: (repoId, id) => invoke('sessions:remove', repoId, id) as Promise<void>,
		clear: (repoId) => invoke('sessions:clear', repoId) as Promise<void>,
		count: (repoId, ref) => invoke('sessions:count', repoId, ref) as Promise<number>,
		watch: (repoId) => invoke('sessions:watch', repoId) as Promise<void>,
		unwatch: () => invoke('sessions:unwatch') as Promise<void>
	},
	comments: {
		list: (repoId, contextKey) =>
			invoke('comments:list', repoId, contextKey) as Promise<LocalComment[]>,
		add: (repoId, input: NewLocalCommentInput) =>
			invoke('comments:add', repoId, input) as Promise<LocalComment>,
		edit: (repoId, id, body) =>
			invoke('comments:edit', repoId, id, body) as Promise<LocalComment | null>,
		resolve: (repoId, id, resolver: LocalCommentAuthor, sessionId) =>
			invoke('comments:resolve', repoId, id, resolver, sessionId) as Promise<LocalComment | null>,
		unresolve: (repoId, id) =>
			invoke('comments:unresolve', repoId, id) as Promise<LocalComment | null>,
		remove: (repoId, id) => invoke('comments:remove', repoId, id) as Promise<void>,
		watch: (repoId) => invoke('comments:watch', repoId) as Promise<void>,
		unwatch: () => invoke('comments:unwatch') as Promise<void>
	},
	tasks: {
		list: (repoId, branch, ref) => invoke('tasks:list', repoId, branch, ref) as Promise<Task[]>,
		add: (repoId, branch, input: NewTaskInput) =>
			invoke('tasks:add', repoId, branch, input) as Promise<Task>,
		update: (repoId, branch, id, patch: TaskPatch) =>
			invoke('tasks:update', repoId, branch, id, patch) as Promise<Task | null>,
		setDone: (repoId, branch, id, done, actor: TaskActor) =>
			invoke('tasks:setDone', repoId, branch, id, done, actor) as Promise<Task | null>,
		remove: (repoId, branch, id) => invoke('tasks:remove', repoId, branch, id) as Promise<void>,
		reorder: (repoId, branch, ids) => invoke('tasks:reorder', repoId, branch, ids) as Promise<void>,
		clear: (repoId, branch) => invoke('tasks:clear', repoId, branch) as Promise<void>,
		watch: (repoId) => invoke('tasks:watch', repoId) as Promise<void>,
		unwatch: () => invoke('tasks:unwatch') as Promise<void>
	},
	aiConfig: {
		status: (repoId) => invoke('aiConfig:status', repoId) as Promise<AiConfigStatus>,
		apply: (repoId, request) =>
			invoke('aiConfig:apply', repoId, request) as Promise<AiConfigApplyResult>,
		remove: (repoId, item) =>
			invoke('aiConfig:remove', repoId, item) as Promise<AiConfigRemoveResult>
	},
	npm: {
		getPackageInfo: (name) => invoke('npm:getPackageInfo', name) as Promise<NpmPackageResult>,
		getReleaseNotes: (repositoryUrl, packageName, version) =>
			invoke(
				'npm:getReleaseNotes',
				repositoryUrl,
				packageName,
				version
			) as Promise<ReleaseNotesResult>,
		getReleaseNotesRange: (repositoryUrl, packageName, fromVersion, toVersion) =>
			invoke(
				'npm:getReleaseNotesRange',
				repositoryUrl,
				packageName,
				fromVersion,
				toVersion
			) as Promise<ReleaseNotesRangeResult>
	},
	feedback: {
		// Posts to the Super Review backend, not GitHub. Works signed out.
		submit: (input: FeedbackInput) => invoke('feedback:submit', input) as Promise<FeedbackResult>
	},
	shell: {
		openExternal: (url) => invoke('shell:openExternal', url) as Promise<void>,
		showItemInFolder: (fullPath) => invoke('shell:showItemInFolder', fullPath) as Promise<void>,
		openPath: (fullPath) =>
			invoke('shell:openPath', fullPath) as Promise<{
				ok: boolean;
				error?: string;
			}>
	},
	settings: {
		getPath: () => invoke('settings:getPath') as Promise<string>,
		reveal: () => invoke('settings:reveal') as Promise<void>,
		openInEditor: () => invoke('settings:openInEditor') as Promise<{ ok: boolean; error?: string }>,
		getStartupIssues: () =>
			invoke('settings:getStartupIssues') as Promise<{ malformed: boolean; reset: string[] }>,
		export: () =>
			invoke('settings:export') as Promise<{
				ok: boolean;
				canceled: boolean;
				path?: string;
				error?: string;
			}>,
		import: () =>
			invoke('settings:import') as Promise<{
				ok: boolean;
				canceled: boolean;
				reset?: string[];
				prefs?: UserPrefs;
				error?: string;
			}>,
		reset: () => invoke('settings:reset') as Promise<UserPrefs>
	},
	menu: {
		showFileContextMenu: (params) =>
			invoke('menu:showFileContextMenu', params) as Promise<FileContextMenuResult | null>,
		showDiffLineContextMenu: (params) =>
			invoke('menu:showDiffLineContextMenu', params) as Promise<DiffLineContextMenuAction | null>,
		showBranchContextMenu: (params) =>
			invoke('menu:showBranchContextMenu', params) as Promise<BranchContextMenuAction | null>,
		showPRContextMenu: (params) =>
			invoke('menu:showPRContextMenu', params) as Promise<PRContextMenuAction | null>,
		showTaskContextMenu: (params) =>
			invoke('menu:showTaskContextMenu', params) as Promise<TaskContextMenuAction | null>,
		showRepoContextMenu: (params) =>
			invoke('menu:showRepoContextMenu', params) as Promise<RepoContextMenuAction | null>,
		showCommitContextMenu: () =>
			invoke('menu:showCommitContextMenu') as Promise<CommitContextMenuAction | null>,
		showHeaderContextMenu: (params) =>
			invoke('menu:showHeaderContextMenu', params) as Promise<HeaderContextMenuResult>,
		showEmptyViewContextMenu: (params) =>
			invoke('menu:showEmptyViewContextMenu', params) as Promise<EmptyViewContextMenuResult>,
		showTabsContextMenu: (params) =>
			invoke('menu:showTabsContextMenu', params) as Promise<TabsContextMenuResult>,
		showSidebarControlsContextMenu: (params) =>
			invoke(
				'menu:showSidebarControlsContextMenu',
				params
			) as Promise<SidebarControlsContextMenuResult>,
		showFileHeaderContextMenu: (params) =>
			invoke('menu:showFileHeaderContextMenu', params) as Promise<FileHeaderContextMenuResult>,
		setBranchState: (state: BranchMenuState) => ipcRenderer.send('menu:setBranchState', state),
		setRepositoryState: (state: RepositoryMenuState) =>
			ipcRenderer.send('menu:setRepositoryState', state)
	},
	windowControls: {
		// Ask the main process to re-center the macOS traffic lights for the
		// current zoom factor. The renderer fires this on zoom changes (which the
		// main 'zoom-changed' event misses for keyboard/menu zoom).
		sync: () => ipcRenderer.send('window:syncControls'),
		// Role-menu / window-chrome actions for the Windows HTML AppMenuBar.
		perform: (action: WindowChromeAction) => invoke('window:perform', action) as Promise<void>
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
		onHelpMenuAction(handler) {
			const listener = (_e: Electron.IpcRendererEvent, action: HelpMenuAction) => handler(action);
			ipcRenderer.on('menu:help-action', listener);
			return () => ipcRenderer.off('menu:help-action', listener);
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
		onTasksChanged(handler) {
			const listener = (_e: Electron.IpcRendererEvent, repoId: string) => handler(repoId);
			ipcRenderer.on('tasks:changed', listener);
			return () => ipcRenderer.off('tasks:changed', listener);
		},
		onGithubAuthChanged(handler) {
			const listener = (_e: Electron.IpcRendererEvent, errors: GithubAuthError[]) =>
				handler(errors);
			ipcRenderer.on('github:auth-changed', listener);
			return () => ipcRenderer.off('github:auth-changed', listener);
		},
		onLicenseChanged(handler) {
			const listener = (_e: Electron.IpcRendererEvent, state: LicenseState) => handler(state);
			ipcRenderer.on('license:changed', listener);
			return () => ipcRenderer.off('license:changed', listener);
		},
		onPrefsChanged(handler) {
			const listener = (_e: Electron.IpcRendererEvent, change: PrefsChange) => handler(change);
			ipcRenderer.on('state:prefsChanged', listener);
			return () => ipcRenderer.off('state:prefsChanged', listener);
		},
		onUpdateStatus(handler) {
			const listener = (_e: Electron.IpcRendererEvent, status: UpdateStatus) => handler(status);
			ipcRenderer.on('updater:status', listener);
			return () => ipcRenderer.off('updater:status', listener);
		}
	}
};

contextBridge.exposeInMainWorld('api', api);
