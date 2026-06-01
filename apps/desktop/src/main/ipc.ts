import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import type {
	BranchContextMenuAction,
	BranchContextMenuParams,
	BranchInfo,
	ChangedFile,
	CloneResult,
	CreateRepoDefaults,
	CreateRepoOptions,
	CommitDraft,
	CommitFileSelection,
	CommitResult,
	DeviceFlowStart,
	DeviceFlowStatus,
	DiffContext,
	DiffData,
	EditorKind,
	FileContextMenuAction,
	FileContextMenuParams,
	GithubAccount,
	GithubOrg,
	LastCommit,
	NewReviewCommentInput,
	PRChecksSummary,
	PRReviewComment,
	PRSource,
	PRSummary,
	PublishRepoOptions,
	PullPushResult,
	PushStatus,
	RepoContextMenuAction,
	RepoContextMenuParams,
	RepoInfo,
	Session,
	SessionSummary,
	TerminalKind,
	UserPrefs
} from '@shared/types.js';
import {
	abortMerge,
	buildRepoInfo,
	checkout,
	checkoutPR,
	cloneRepo,
	commit,
	continueMerge,
	createBranch,
	createRepo,
	deleteBranch,
	discardChanges,
	ensureInitialCommit,
	fetchOrigin,
	fetchPRRef,
	getConflicts,
	getDefaultBranch,
	recheckConflicts,
	getCurrentBranch,
	getDiff,
	getLastCommit,
	getPushStatus,
	isGitRepo,
	isWorkingTreeDirty,
	listBranches,
	listChangedFiles,
	mergeIntoCurrent,
	updateFromUpstream,
	pinPRBaseRef,
	pull,
	push,
	scanForRepos,
	setOriginAndPush,
	stageFile,
	undoLastCommit
} from './git-service.js';
import { detectEditors, detectTerminals, openInEditor, openInTerminal } from './editor-service.js';
import * as gh from './github-service.js';
import {
	clearSessions,
	countSessions,
	deleteSession,
	getSession,
	listSessions,
	watchSessionsDir
} from './session-store.js';
import { installSkill, isSkillInstalled } from './skill-service.js';
import { listTemplates } from './repo-templates.js';
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
	upsertRepo
} from './store.js';

function repoOrThrow(id: string): RepoInfo {
	const repo = getRepo(id);
	if (!repo) throw new Error(`Repo not found: ${id}`);
	return repo;
}

// A git-fetchable URL for this fork's `owner/name` counterpart. Derived by
// swapping the owner/repo segment of the fork's own remote URL so the auth
// method (SSH vs HTTPS) and host are preserved; falls back to a public
// github.com HTTPS URL.
function repoFetchUrl(repo: RepoInfo, owner: string, name: string): string {
	const { remoteUrl, githubOwner, githubRepo } = repo;
	if (remoteUrl && githubOwner && githubRepo) {
		const swapped = remoteUrl.replace(`${githubOwner}/${githubRepo}`, `${owner}/${name}`);
		if (swapped !== remoteUrl) return swapped;
	}
	return `https://github.com/${owner}/${name}.git`;
}

// A git-fetchable URL for the fork's upstream (parent) repo.
function upstreamFetchUrl(repo: RepoInfo): string {
	return repoFetchUrl(repo, repo.upstreamOwner ?? '', repo.upstreamRepo ?? '');
}

function broadcast(channel: string, payload: unknown): void {
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send(channel, payload);
	}
}

// Broadcast to every window except the one that made the request. The
// initiating renderer's store action already handles activation from the
// returned value, so echoing `active-changed` back to it would trigger a
// redundant switchRepo that races with that activation.
function broadcastToOthers(senderId: number, channel: string, payload: unknown): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.webContents.id === senderId) continue;
		win.webContents.send(channel, payload);
	}
}

// ─── Sessions file watcher ──────────────────────────────────────────────────
// Each renderer subscribes to live updates for its active repo; the main
// process keeps one fs.watch per distinct repo path (shared when multiple
// windows watch the same repo) and broadcasts `sessions:changed` on any change.
// Renderers filter the event by their own active repo. Watchers are reference
// counted so a repo's watch is torn down once the last interested window drops
// it (or is destroyed).
const sessionWatchers = new Map<string, { close: () => void; refs: number }>();
const sessionWatchByContents = new Map<number, string>();
const sessionWatchHooked = new Set<number>();

function releaseSessionWatch(repoPath: string): void {
	const entry = sessionWatchers.get(repoPath);
	if (!entry) return;
	entry.refs -= 1;
	if (entry.refs <= 0) {
		entry.close();
		sessionWatchers.delete(repoPath);
	}
}

function setSessionWatch(sender: Electron.WebContents, repoId: string): void {
	const repo = getRepo(repoId);
	if (!repo) return;
	const prev = sessionWatchByContents.get(sender.id);
	if (prev === repo.path) return; // Already watching this repo for this window.
	if (prev) releaseSessionWatch(prev);
	sessionWatchByContents.set(sender.id, repo.path);

	const entry = sessionWatchers.get(repo.path);
	if (entry) {
		entry.refs += 1;
	} else {
		const close = watchSessionsDir(repo.path, () => broadcast('sessions:changed', repoId));
		sessionWatchers.set(repo.path, { close, refs: 1 });
	}

	// Drop this window's watch when it goes away (registered once per window).
	if (!sessionWatchHooked.has(sender.id)) {
		sessionWatchHooked.add(sender.id);
		sender.once('destroyed', () => clearSessionWatch(sender.id));
	}
}

function clearSessionWatch(senderId: number): void {
	const prev = sessionWatchByContents.get(senderId);
	if (prev) releaseSessionWatch(prev);
	sessionWatchByContents.delete(senderId);
	sessionWatchHooked.delete(senderId);
}

// Re-run buildRepoInfo off the critical path. If anything moved (favicon
// added, remote URL changed, default branch updated) we persist and re-emit
// active-changed so the UI picks it up. No-op when nothing changed.
// buildRepoInfo derives only git/path metadata. When re-opening a repo we've
// seen before (id is path-derived), carry over the user's pinned account so it
// isn't clobbered by the rebuilt record.
function preservePinnedAccount(info: RepoInfo): RepoInfo {
	const existing = getRepo(info.id);
	return existing?.githubAccountId ? { ...info, githubAccountId: existing.githubAccountId } : info;
}

async function refreshRepoInfoInBackground(repoPath: string, previous: RepoInfo): Promise<void> {
	try {
		const fresh = await buildRepoInfo(repoPath);
		// buildRepoInfo only derives git/path metadata, so carry over fields the
		// user owns (last-opened time, the project's pinned GitHub account).
		const merged: RepoInfo = {
			...fresh,
			lastOpenedAt: previous.lastOpenedAt,
			githubAccountId: previous.githubAccountId
		};
		const changed =
			merged.iconDataUrl !== previous.iconDataUrl ||
			merged.remoteUrl !== previous.remoteUrl ||
			merged.defaultBranch !== previous.defaultBranch ||
			merged.githubOwner !== previous.githubOwner ||
			merged.githubRepo !== previous.githubRepo ||
			merged.description !== previous.description ||
			merged.name !== previous.name;
		if (!changed) return;
		upsertRepo(merged);
		broadcast('repos:active-changed', merged);
	} catch {
		// Background refresh — failure is silent.
	}
}

export function registerIpc(): void {
	// ─── Repos ─────────────────────────────────────────────────────────────
	ipcMain.handle('repos:list', async (): Promise<RepoInfo[]> => listRepos());

	ipcMain.handle('repos:openPicker', async (e): Promise<RepoInfo | null> => {
		const result = await dialog.showOpenDialog({
			title: 'Open repository',
			properties: ['openDirectory']
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		const repoPath = result.filePaths[0];
		if (!(await isGitRepo(repoPath))) {
			throw new Error(`Not a git repository: ${repoPath}`);
		}
		const info = preservePinnedAccount(await buildRepoInfo(repoPath));
		upsertRepo(info);
		setPrefs({ activeRepoId: info.id });
		broadcastToOthers(e.sender.id, 'repos:active-changed', info);
		return info;
	});

	ipcMain.handle('repos:openFolder', async (e): Promise<RepoInfo[]> => {
		const result = await dialog.showOpenDialog({
			title: 'Open folder',
			buttonLabel: 'Scan folder',
			properties: ['openDirectory']
		});
		if (result.canceled || result.filePaths.length === 0) return [];
		const root = result.filePaths[0];
		const repoPaths = await scanForRepos(root);
		if (repoPaths.length === 0) {
			throw new Error(`No git repositories found in: ${root}`);
		}
		const infos = await Promise.all(
			repoPaths.map(async (p) => preservePinnedAccount(await buildRepoInfo(p)))
		);
		for (const info of infos) upsertRepo(info);
		// Land the user in one of the freshly added repos (alphabetically first, so
		// it's deterministic) rather than leaving them on the empty state.
		infos.sort((a, b) => a.name.localeCompare(b.name));
		const active = infos[0];
		setPrefs({ activeRepoId: active.id });
		broadcastToOthers(e.sender.id, 'repos:active-changed', active);
		return infos;
	});

	ipcMain.handle('repos:addByPath', async (e, repoPath: string): Promise<RepoInfo | null> => {
		if (!(await isGitRepo(repoPath))) {
			throw new Error(`Not a git repository: ${repoPath}`);
		}
		const info = preservePinnedAccount(await buildRepoInfo(repoPath));
		upsertRepo(info);
		setPrefs({ activeRepoId: info.id });
		broadcastToOthers(e.sender.id, 'repos:active-changed', info);
		return info;
	});

	ipcMain.handle('repos:chooseDirectory', async (): Promise<string | null> => {
		const result = await dialog.showOpenDialog({
			title: 'Choose a folder',
			buttonLabel: 'Select',
			properties: ['openDirectory', 'createDirectory']
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0];
	});

	ipcMain.handle('repos:isGitRepo', async (_e, dirPath: string): Promise<boolean> => {
		if (!dirPath?.trim()) return false;
		return isGitRepo(dirPath);
	});

	ipcMain.handle('repos:getCreateDefaults', async (): Promise<CreateRepoDefaults> => {
		const { gitignores, licenses } = listTemplates();
		// Mirror GitHub Desktop's default home for new repos.
		const defaultPath = path.join(app.getPath('documents'), 'GitHub');
		return { defaultPath, gitignores, licenses };
	});

	ipcMain.handle(
		'repos:createRepo',
		async (e, options: CreateRepoOptions): Promise<RepoInfo | null> => {
			const result = await createRepo(options);
			if (!result.ok || !result.path) {
				throw new Error(result.error ?? 'Failed to create repository.');
			}
			const info = preservePinnedAccount(await buildRepoInfo(result.path));
			upsertRepo(info);
			setPrefs({ activeRepoId: info.id });
			broadcastToOthers(e.sender.id, 'repos:active-changed', info);
			return info;
		}
	);

	// Orgs the repo's account (its pin, else the app default) can publish under.
	ipcMain.handle('github:listOrganizations', async (_e, repoId?: string): Promise<GithubOrg[]> => {
		const accountId = repoId ? getRepo(repoId)?.githubAccountId : null;
		return gh.listOrganizations(accountId).catch(() => []);
	});

	// Publish a local repo to GitHub: create the remote (under the chosen org or
	// the account), set it as `origin`, and push the current branch. Returns the
	// refreshed RepoInfo so the renderer picks up the new owner/remote.
	ipcMain.handle(
		'repos:publish',
		async (e, repoId: string, options: PublishRepoOptions): Promise<RepoInfo> => {
			const repo = repoOrThrow(repoId);
			const accountId = repo.githubAccountId ?? null;
			// A freshly-created repo leaves its seeded files uncommitted (unborn
			// branch), which has nothing to push. Make the initial commit first so
			// "create → publish" works without a manual commit step.
			await ensureInitialCommit(repo.path, 'Initial commit', gh.resolveCommitIdentity(accountId));
			const remote = await gh.createRemoteRepo({
				name: options.name,
				description: options.description,
				private: options.private,
				org: options.org,
				accountId
			});
			const result = await setOriginAndPush(repo.path, remote.cloneUrl);
			if (!result.ok) {
				throw new Error(
					result.error
						? `Repository created at ${remote.htmlUrl}, but the push failed: ${result.error}`
						: 'Failed to push to the new remote.'
				);
			}
			const info = preservePinnedAccount(await buildRepoInfo(repo.path));
			upsertRepo(info);
			broadcastToOthers(e.sender.id, 'repos:active-changed', info);
			return info;
		}
	);

	ipcMain.handle('repos:remove', async (e, id: string, moveToTrash?: boolean) => {
		// Grab the path before de-registering so we can trash the folder after.
		const repo = getRepo(id);
		removeRepo(id);
		if (moveToTrash && repo) {
			// Trashing a large working tree can take seconds. De-registration is
			// already done, so don't make the renderer wait — trash in the
			// background and report a failure back so the UI can surface it.
			void shell.trashItem(repo.path).catch(() => {
				e.sender.send('repos:trash-failed', repo.name);
			});
		}
	});

	ipcMain.handle('repos:setActive', async (_e, id: string): Promise<RepoInfo | null> => {
		const repo = getRepo(id);
		if (!repo) return null;
		// Switching needs to feel instant — buildRepoInfo rescans the favicon
		// tree, queries git remotes, and resolves origin/HEAD, easily adding
		// 100ms-1s on a large repo. None of that data changes between switches,
		// so we return the stored info immediately and refresh in the background.
		const updated: RepoInfo = { ...repo, lastOpenedAt: Date.now() };
		upsertRepo(updated);
		setPrefs({ activeRepoId: id });
		broadcast('repos:active-changed', updated);

		void refreshRepoInfoInBackground(repo.path, updated);
		return updated;
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
		'git:checkoutPR',
		async (_e, repoId: string, pr: PRSummary, source: PRSource = 'fork') => {
			const repo = repoOrThrow(repoId);
			// Base remote used only for the read-only fallback (deleted head repo).
			const fallbackRemote =
				source === 'upstream' && repo.upstreamOwner && repo.upstreamRepo
					? upstreamFetchUrl(repo)
					: 'origin';
			await checkoutPR(repo.path, {
				prNumber: pr.number,
				headRef: pr.headRef,
				headRepoUrl: pr.headRepoCloneUrl,
				headRepoOwner: pr.headRepoOwner,
				originUrl: repo.remoteUrl,
				fallbackRemote
			});
			// Remember which PR this branch maps to so the UI resolves "View PR"
			// later, even for cross-repo PRs a head-based lookup can't find.
			setPRBranch(repoId, pr.headRef, { number: pr.number, source });
		}
	);

	ipcMain.handle('git:isDirty', async (_e, repoId: string): Promise<boolean> => {
		return isWorkingTreeDirty(repoOrThrow(repoId).path);
	});

	ipcMain.handle(
		'git:createBranch',
		async (_e, repoId: string, name: string, opts: { base?: string; checkout: boolean }) =>
			createBranch(repoOrThrow(repoId).path, name, opts)
	);

	ipcMain.handle(
		'git:deleteBranch',
		async (_e, repoId: string, name: string, opts: { deleteRemote: boolean; upstream?: string }) =>
			deleteBranch(repoOrThrow(repoId).path, name, opts)
	);

	ipcMain.handle(
		'git:listChangedFiles',
		async (_e, repoId: string, ctx: DiffContext): Promise<ChangedFile[]> => {
			// Sessions are frozen snapshots on disk, not live git state — serve their
			// file list straight from the manifest.
			if (ctx.kind === 'session') {
				const session = await getSession(repoOrThrow(repoId).path, ctx.sessionId);
				return (session?.files ?? []).map((f) => ({
					path: f.path,
					oldPath: f.oldPath,
					status: f.status,
					additions: f.additions,
					deletions: f.deletions,
					isBinary: f.isBinary
				}));
			}
			return listChangedFiles(repoOrThrow(repoId).path, ctx);
		}
	);

	ipcMain.handle(
		'git:getDiff',
		async (_e, repoId: string, filePath: string, ctx: DiffContext): Promise<DiffData> => {
			// Session diffs come from the manifest, not git.
			if (ctx.kind === 'session') {
				const session = await getSession(repoOrThrow(repoId).path, ctx.sessionId);
				const f = session?.files.find((x) => x.path === filePath);
				if (!f) {
					throw new Error(`File not in session ${ctx.sessionId}: ${filePath}`);
				}
				return {
					file: {
						path: f.path,
						oldPath: f.oldPath,
						status: f.status,
						additions: f.additions,
						deletions: f.deletions,
						isBinary: f.isBinary
					},
					patch: f.patch,
					oldContents: f.oldContents,
					newContents: f.newContents,
					truncated: f.truncated,
					oldImage: f.oldImage,
					newImage: f.newImage
				};
			}
			return getDiff(repoOrThrow(repoId).path, filePath, ctx);
		}
	);

	ipcMain.handle('git:fetchOrigin', async (_e, repoId: string) => {
		return fetchOrigin(repoOrThrow(repoId).path);
	});

	ipcMain.handle('git:getPushStatus', async (_e, repoId: string): Promise<PushStatus> => {
		const repo = repoOrThrow(repoId);
		let defaultBranch = repo.defaultBranch;
		if (!defaultBranch) {
			// Backfill the cached default branch for repos persisted before it could
			// be resolved (e.g. added when origin/HEAD wasn't set). Without it the
			// ahead/behind-of-default counts — and the Create PR button they gate —
			// stay broken until the repo is re-added. getPushStatus already resolves
			// live, but persisting here means it's a one-time cost, not every poll.
			const detected = await getDefaultBranch(repo.path);
			if (detected) {
				defaultBranch = detected;
				const merged: RepoInfo = { ...repo, defaultBranch: detected };
				upsertRepo(merged);
				broadcast('repos:active-changed', merged);
			}
		}
		return getPushStatus(repo.path, defaultBranch);
	});

	ipcMain.handle(
		'git:pull',
		async (_e, repoId: string): Promise<PullPushResult> => pull(repoOrThrow(repoId).path)
	);

	ipcMain.handle(
		'git:push',
		async (_e, repoId: string): Promise<PullPushResult> => push(repoOrThrow(repoId).path)
	);

	ipcMain.handle(
		'git:mergeIntoCurrent',
		async (_e, repoId: string, ref: string): Promise<PullPushResult> =>
			mergeIntoCurrent(repoOrThrow(repoId).path, ref)
	);

	ipcMain.handle(
		'git:updateFromUpstream',
		async (_e, repoId: string, branch: string): Promise<PullPushResult> => {
			const repo = repoOrThrow(repoId);
			if (!repo.upstreamOwner || !repo.upstreamRepo) {
				return {
					ok: false,
					conflicts: [],
					error: 'This repository does not have an upstream.'
				};
			}
			return updateFromUpstream(repo.path, upstreamFetchUrl(repo), branch);
		}
	);

	ipcMain.handle(
		'git:getConflicts',
		async (_e, repoId: string): Promise<string[]> => getConflicts(repoOrThrow(repoId).path)
	);

	ipcMain.handle(
		'git:recheckConflicts',
		async (_e, repoId: string, files: string[]): Promise<string[]> =>
			recheckConflicts(repoOrThrow(repoId).path, files)
	);

	ipcMain.handle(
		'git:stageFile',
		async (_e, repoId: string, filePath: string): Promise<void> =>
			stageFile(repoOrThrow(repoId).path, filePath)
	);

	ipcMain.handle(
		'git:discardChanges',
		async (_e, repoId: string, filePath: string, oldPath?: string): Promise<void> =>
			discardChanges(repoOrThrow(repoId).path, filePath, oldPath)
	);

	ipcMain.handle(
		'git:continueMerge',
		async (_e, repoId: string): Promise<PullPushResult> => continueMerge(repoOrThrow(repoId).path)
	);

	ipcMain.handle('git:abortMerge', async (_e, repoId: string): Promise<void> => {
		await abortMerge(repoOrThrow(repoId).path);
	});

	ipcMain.handle(
		'git:commit',
		async (
			_e,
			repoId: string,
			message: string,
			files: CommitFileSelection[]
		): Promise<CommitResult> => {
			const repo = repoOrThrow(repoId);
			const identity = gh.resolveCommitIdentity(repo.githubAccountId);
			return commit(repo.path, message, files, identity);
		}
	);

	ipcMain.handle(
		'git:getLastCommit',
		async (_e, repoId: string): Promise<LastCommit | null> =>
			getLastCommit(repoOrThrow(repoId).path)
	);

	ipcMain.handle(
		'git:undoLastCommit',
		async (_e, repoId: string): Promise<CommitResult> => undoLastCommit(repoOrThrow(repoId).path)
	);

	ipcMain.handle('git:cloneRepo', async (_e, url: string): Promise<CloneResult> => {
		const dir = await dialog.showOpenDialog({
			title: 'Clone destination',
			properties: ['openDirectory', 'createDirectory']
		});
		if (dir.canceled || dir.filePaths.length === 0) {
			return { ok: false, error: 'Clone cancelled.' };
		}
		const result = await cloneRepo(url, dir.filePaths[0]);
		if (result.ok && result.path) {
			const info = preservePinnedAccount(await buildRepoInfo(result.path));
			upsertRepo(info);
			setPrefs({ activeRepoId: info.id });
			broadcast('repos:active-changed', info);
		}
		return result;
	});

	// ─── Editor ────────────────────────────────────────────────────────────
	ipcMain.handle('editor:detect', async () => detectEditors());
	ipcMain.handle('editor:open', async (_e, editor: EditorKind, target: string) =>
		openInEditor(editor, target)
	);

	// ─── Terminal ──────────────────────────────────────────────────────────
	ipcMain.handle('terminal:detect', async () => detectTerminals());
	ipcMain.handle('terminal:open', async (_e, terminal: TerminalKind, target: string) =>
		openInTerminal(terminal, target)
	);

	// ─── GitHub ────────────────────────────────────────────────────────────
	ipcMain.handle('github:listAccounts', async (): Promise<GithubAccount[]> => gh.listAccounts());
	ipcMain.handle(
		'github:getActiveAccount',
		async (): Promise<GithubAccount | null> => gh.getActiveAccount()
	);
	ipcMain.handle(
		'github:setActiveAccount',
		async (_e, id: string): Promise<GithubAccount | null> => gh.setActiveAccount(id)
	);
	ipcMain.handle('github:removeAccount', async (_e, id: string) => gh.removeAccount(id));
	ipcMain.handle(
		'github:setRepoAccount',
		async (_e, repoId: string, accountId: string | null): Promise<RepoInfo | null> => {
			const updated = setRepoGithubAccountId(repoId, accountId);
			if (updated) broadcast('repos:active-changed', updated);
			return updated;
		}
	);
	ipcMain.handle(
		'github:startDeviceFlow',
		async (): Promise<DeviceFlowStart> => gh.startDeviceFlow()
	);
	ipcMain.handle(
		'github:pollDeviceFlow',
		async (): Promise<DeviceFlowStatus> => gh.pollDeviceFlow()
	);
	ipcMain.handle('github:cancelDeviceFlow', async () => gh.cancelDeviceFlow());

	ipcMain.handle(
		'github:listPRs',
		async (_e, repoId: string, page = 1, source: PRSource = 'fork'): Promise<PRSummary[]> => {
			const repo = repoOrThrow(repoId);
			const owner = source === 'upstream' ? repo.upstreamOwner : repo.githubOwner;
			const name = source === 'upstream' ? repo.upstreamRepo : repo.githubRepo;
			if (!owner || !name) {
				throw new Error(
					source === 'upstream'
						? 'This repository does not have an upstream.'
						: 'This repository does not have a GitHub remote.'
				);
			}
			return gh.listPullRequests(owner, name, repo.githubAccountId, page);
		}
	);

	ipcMain.handle('github:detectUpstream', async (_e, repoId: string): Promise<RepoInfo | null> => {
		const repo = repoOrThrow(repoId);
		if (!repo.githubOwner || !repo.githubRepo) return repo;
		let upstream: { owner: string; repo: string } | null;
		try {
			upstream = await gh.getUpstream(repo.githubOwner, repo.githubRepo, repo.githubAccountId);
		} catch {
			upstream = null;
		}
		return setRepoUpstream(repoId, upstream) ?? repo;
	});

	ipcMain.handle(
		'github:fetchPR',
		async (
			_e,
			repoId: string,
			prNumber: number,
			prOwner?: string,
			prRepo?: string
		): Promise<{ headRef: string; baseRef: string }> => {
			const repo = repoOrThrow(repoId);
			// The PR's host (base) repo — the parent for an upstream PR on a fork,
			// otherwise our own. Falls back to the active repo's coordinates.
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			const { baseRef } = await gh.getPRBase(owner, name, prNumber, repo.githubAccountId);
			// When the PR's base repo isn't our origin (an upstream PR on a fork), its
			// head and base refs live in that repo — fetch them from its URL so the
			// diff compares against the upstream branch, not the fork's stale copy.
			const isOrigin =
				owner.toLowerCase() === (repo.githubOwner ?? '').toLowerCase() &&
				name.toLowerCase() === (repo.githubRepo ?? '').toLowerCase();
			const remote = isOrigin ? 'origin' : repoFetchUrl(repo, owner, name);
			const refs = await fetchPRRef(repo.path, prNumber, remote);
			await pinPRBaseRef(repo.path, prNumber, baseRef, remote);
			return refs;
		}
	);

	ipcMain.handle(
		'github:findPRForBranch',
		async (_e, repoId: string, branch: string): Promise<PRSummary | null> => {
			const repo = repoOrThrow(repoId);
			if (!repo.githubOwner || !repo.githubRepo) {
				console.log(
					`[github] findPRForBranch skipped: repo "${repo.name}" has no GitHub remote ` +
						`(owner=${repo.githubOwner ?? '∅'} repo=${repo.githubRepo ?? '∅'})`
				);
				return null;
			}
			try {
				const pr = await gh.findPRForBranch(
					repo.githubOwner,
					repo.githubRepo,
					branch,
					repo.githubAccountId
				);
				if (pr) return pr;
			} catch (err) {
				console.error(
					`[github] findPRForBranch failed for ${repo.githubOwner}/${repo.githubRepo} ` +
						`branch=${branch} pinnedAccountId=${repo.githubAccountId ?? '(none)'}:`,
					err instanceof Error ? err.message : err
				);
			}
			// A head-based lookup misses cross-repo PRs (the head owner isn't us).
			// Fall back to the association we recorded when the branch was checked
			// out from the PR list, resolving against the right repo.
			const link = getPRBranch(repoId, branch);
			if (link) {
				const owner = link.source === 'upstream' ? repo.upstreamOwner : repo.githubOwner;
				const name = link.source === 'upstream' ? repo.upstreamRepo : repo.githubRepo;
				if (owner && name) {
					try {
						return await gh.getPRSummary(owner, name, link.number, repo.githubAccountId);
					} catch {
						return null;
					}
				}
			}
			return null;
		}
	);

	ipcMain.handle(
		'github:canPushToPR',
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
						maintainerCanModify: pr.maintainerCanModify
					},
					repo.githubAccountId
				);
			} catch {
				return false;
			}
		}
	);

	ipcMain.handle(
		'github:getChecks',
		async (
			_e,
			repoId: string,
			ref: string,
			prOwner?: string,
			prRepo?: string
		): Promise<PRChecksSummary> => {
			const repo = repoOrThrow(repoId);
			const empty: PRChecksSummary = { state: 'none', checks: [] };
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) return empty;
			try {
				return await gh.getChecks(owner, name, ref, repo.githubAccountId);
			} catch (err) {
				console.error(
					`[github] getChecks failed for ${owner}/${name} ref=${ref}:`,
					err instanceof Error ? err.message : err
				);
				return empty;
			}
		}
	);

	ipcMain.handle(
		'github:getPR',
		async (
			_e,
			repoId: string,
			prNumber: number,
			prOwner?: string,
			prRepo?: string
		): Promise<PRSummary | null> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) return null;
			return gh.getPRSummary(owner, name, prNumber, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:listReviewComments',
		async (
			_e,
			repoId: string,
			prNumber: number,
			prOwner?: string,
			prRepo?: string
		): Promise<PRReviewComment[]> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.listReviewComments(owner, name, prNumber, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:createReviewComment',
		async (
			_e,
			repoId: string,
			input: NewReviewCommentInput,
			prOwner?: string,
			prRepo?: string
		): Promise<PRReviewComment> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.createReviewComment(owner, name, input, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:replyReviewComment',
		async (
			_e,
			repoId: string,
			prNumber: number,
			commentId: number,
			body: string,
			prOwner?: string,
			prRepo?: string
		): Promise<PRReviewComment> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.replyReviewComment(owner, name, prNumber, commentId, body, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:deleteReviewComment',
		async (
			_e,
			repoId: string,
			commentId: number,
			prOwner?: string,
			prRepo?: string
		): Promise<void> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			await gh.deleteReviewComment(owner, name, commentId, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:setReviewThreadResolved',
		async (
			_e,
			repoId: string,
			threadId: string,
			resolved: boolean
		): Promise<{ isResolved: boolean }> => {
			const repo = repoOrThrow(repoId);
			// threadId is a global GraphQL node id, so no owner/repo is needed —
			// only the account whose token authorizes the mutation.
			return gh.setReviewThreadResolved(threadId, resolved, repo.githubAccountId);
		}
	);

	// ─── Shell ─────────────────────────────────────────────────────────────
	ipcMain.handle('shell:openExternal', async (_e, url: string): Promise<void> => {
		await shell.openExternal(url);
	});

	// Reveal a file in the OS file manager (Finder / Explorer), selecting it.
	ipcMain.handle('shell:showItemInFolder', async (_e, fullPath: string): Promise<void> => {
		shell.showItemInFolder(fullPath);
	});

	// Open a file with the OS default program for its type. shell.openPath
	// resolves to an error string ("" on success), which we surface to the UI.
	ipcMain.handle(
		'shell:openPath',
		async (_e, fullPath: string): Promise<{ ok: boolean; error?: string }> => {
			const error = await shell.openPath(fullPath);
			return error ? { ok: false, error } : { ok: true };
		}
	);

	// ─── Menu ──────────────────────────────────────────────────────────────
	// Pop up a native OS context menu for a file row and resolve with the chosen
	// action. The renderer performs the action itself (reusing its git/shell
	// calls so it can refresh afterward); we only render the menu and — for the
	// destructive discard — gate it behind a native confirmation dialog.
	ipcMain.handle(
		'menu:showFileContextMenu',
		async (e, params: FileContextMenuParams): Promise<FileContextMenuAction | null> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			let chosen: FileContextMenuAction | null = null;
			const item = (label: string, action: FileContextMenuAction): MenuItemConstructorOptions => ({
				label,
				click: () => {
					chosen = action;
				}
			});

			const template: MenuItemConstructorOptions[] = [];
			if (params.selectedCount > 1) {
				// Multi-selection: only show actions that apply to the whole selection.
				// The single-file copy/reveal/open items target just one file, so they
				// are omitted here. Discard and include/exclude live in their own
				// groups.
				const n = params.selectedCount;
				const groups: MenuItemConstructorOptions[][] = [];
				if (params.canDiscard) {
					groups.push([item(`Discard ${n} Selected Files`, 'discardSelected')]);
				}
				if (params.canInclude) {
					groups.push([
						item(`Include ${n} Selected Files`, 'includeSelected'),
						item(`Exclude ${n} Selected Files`, 'excludeSelected')
					]);
				}
				groups.forEach((group, i) => {
					if (i > 0) template.push({ type: 'separator' });
					template.push(...group);
				});
			} else {
				if (params.canDiscard) {
					template.push(item('Discard Changes', 'discard'));
					template.push({ type: 'separator' });
				}
				template.push(item('Copy File Path', 'copyPath'));
				template.push(item('Copy Relative File Path', 'copyRelativePath'));
				template.push({ type: 'separator' });
				template.push(item(params.revealLabel, 'reveal'));
				if (params.editorLabel) {
					template.push(item(`Open in ${params.editorLabel}`, 'openInEditor'));
				}
				template.push(item('Open with Default Program', 'openDefault'));
			}

			const menu = Menu.buildFromTemplate(template);
			return await new Promise<FileContextMenuAction | null>((resolve) => {
				menu.popup({
					window: win ?? undefined,
					callback: () => resolve(chosen)
				});
			});
		}
	);

	// Pop up a native OS context menu for a branch row and resolve with the
	// chosen action. As with files, the renderer performs the action itself
	// (copy / confirm-and-delete) so it can refresh afterward.
	ipcMain.handle(
		'menu:showBranchContextMenu',
		async (e, params: BranchContextMenuParams): Promise<BranchContextMenuAction | null> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			let chosen: BranchContextMenuAction | null = null;
			const item = (
				label: string,
				action: BranchContextMenuAction
			): MenuItemConstructorOptions => ({
				label,
				click: () => {
					chosen = action;
				}
			});

			const template: MenuItemConstructorOptions[] = [item('Copy Branch Name', 'copy')];
			if (params.canDelete) {
				template.push({ type: 'separator' });
				template.push(item('Delete Branch…', 'delete'));
			}

			const menu = Menu.buildFromTemplate(template);
			return await new Promise<BranchContextMenuAction | null>((resolve) => {
				menu.popup({
					window: win ?? undefined,
					callback: () => resolve(chosen)
				});
			});
		}
	);

	// Repo-row context menu (in the repo picker). Returns the chosen action so the
	// renderer can run it — "remove" de-registers the repo without touching disk.
	ipcMain.handle(
		'menu:showRepoContextMenu',
		async (e, params: RepoContextMenuParams): Promise<RepoContextMenuAction | null> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			let chosen: RepoContextMenuAction | null = null;
			const item = (label: string, action: RepoContextMenuAction): MenuItemConstructorOptions => ({
				label,
				click: () => {
					chosen = action;
				}
			});

			const template: MenuItemConstructorOptions[] = [
				item('Copy Path', 'copyPath'),
				item(params.revealLabel, 'reveal'),
				{ type: 'separator' },
				item('Remove…', 'remove')
			];

			const menu = Menu.buildFromTemplate(template);
			return await new Promise<RepoContextMenuAction | null>((resolve) => {
				menu.popup({
					window: win ?? undefined,
					callback: () => resolve(chosen)
				});
			});
		}
	);

	// ─── State ─────────────────────────────────────────────────────────────
	ipcMain.handle('state:getPrefs', async (): Promise<UserPrefs> => getPrefs());
	ipcMain.handle(
		'state:setPrefs',
		async (_e, patch: Partial<UserPrefs>): Promise<UserPrefs> => setPrefs(patch)
	);

	ipcMain.handle(
		'state:getSeenFiles',
		async (_e, repoId: string, contextKey: string): Promise<string[]> => {
			return getSeen(repoId, contextKey);
		}
	);

	ipcMain.handle(
		'state:setFileSeen',
		async (_e, repoId: string, contextKey: string, filePath: string, seen: boolean) => {
			setSeen(repoId, contextKey, filePath, seen);
		}
	);

	ipcMain.handle('state:clearSeen', async (_e, repoId: string, contextKey: string) =>
		clearSeen(repoId, contextKey)
	);

	ipcMain.handle(
		'state:getCollapsedFiles',
		async (_e, repoId: string, contextKey: string): Promise<string[]> => {
			return getCollapsedFiles(repoId, contextKey);
		}
	);

	ipcMain.handle(
		'state:setFileCollapsed',
		async (_e, repoId: string, contextKey: string, filePath: string, collapsed: boolean) => {
			setFileCollapsed(repoId, contextKey, filePath, collapsed);
		}
	);

	ipcMain.handle('state:clearCollapsedFiles', async (_e, repoId: string, contextKey: string) =>
		clearCollapsedFiles(repoId, contextKey)
	);

	ipcMain.handle(
		'state:getCommitDraft',
		async (_e, repoId: string): Promise<CommitDraft> => getCommitDraft(repoId)
	);

	ipcMain.handle(
		'state:setCommitDraft',
		async (_e, repoId: string, draft: CommitDraft): Promise<void> => {
			setCommitDraft(repoId, draft);
		}
	);

	ipcMain.handle(
		'sessions:list',
		async (_e, repoId: string): Promise<SessionSummary[]> => listSessions(repoOrThrow(repoId).path)
	);

	ipcMain.handle(
		'sessions:get',
		async (_e, repoId: string, id: string): Promise<Session | null> =>
			getSession(repoOrThrow(repoId).path, id)
	);

	ipcMain.handle(
		'sessions:remove',
		async (_e, repoId: string, id: string): Promise<void> =>
			deleteSession(repoOrThrow(repoId).path, id)
	);

	ipcMain.handle(
		'sessions:clear',
		async (_e, repoId: string): Promise<void> => clearSessions(repoOrThrow(repoId).path)
	);

	ipcMain.handle(
		'sessions:count',
		async (_e, repoId: string): Promise<number> => countSessions(repoOrThrow(repoId).path)
	);

	// Start/stop live session updates for the calling window's active repo. A null
	// repoId (or unwatch) tears down this window's watch.
	ipcMain.handle('sessions:watch', (e, repoId: string | null): void => {
		if (repoId) setSessionWatch(e.sender, repoId);
		else clearSessionWatch(e.sender.id);
	});

	ipcMain.handle('sessions:unwatch', (e): void => clearSessionWatch(e.sender.id));

	// ─── Skill ─────────────────────────────────────────────────────────────
	// The document-session skill teaches an agent how/when to record a session.
	// The UI checks whether it's installed in the active repo and offers to drop
	// it in when it isn't.
	ipcMain.handle(
		'skill:isInstalled',
		async (_e, repoId: string): Promise<boolean> => isSkillInstalled(repoOrThrow(repoId).path)
	);

	ipcMain.handle('skill:install', async (_e, repoId: string): Promise<void> => {
		await installSkill(repoOrThrow(repoId).path);
	});
}
