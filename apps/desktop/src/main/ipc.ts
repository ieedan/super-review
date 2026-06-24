import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import type {
	BranchContextMenuAction,
	BranchContextMenuParams,
	CommitContextMenuAction,
	PRContextMenuAction,
	PRContextMenuParams,
	BranchInfo,
	ChangedFile,
	ChangesetStatus,
	CreateChangesetInput,
	CloneResult,
	CreateRepoDefaults,
	CreateRepoOptions,
	CommitDraft,
	CommitAuthorIdentity,
	CommitFileSelection,
	CommitInfo,
	CommitResult,
	DeviceFlowStart,
	DeviceFlowStatus,
	FeedbackInput,
	FeedbackResult,
	DiffContext,
	DiffData,
	DiffLineContextMenuAction,
	DiffLineContextMenuParams,
	EditorKind,
	FileContextMenuAction,
	FileContextMenuParams,
	GithubAccount,
	GithubAuthError,
	GithubOrg,
	LastCommit,
	LocalOnlyBranch,
	ManagedStash,
	NewReviewCommentInput,
	NpmPackageResult,
	ReleaseNotesResult,
	ReleaseNotesRangeResult,
	PRChecksSummary,
	PRConversationItem,
	PRMergeMethod,
	PRMergeResult,
	PRReviewComment,
	PRSource,
	PRSummary,
	PublishRepoOptions,
	PullPushResult,
	PushStatus,
	RepoContextMenuAction,
	RepoContextMenuParams,
	HeaderContextMenuParams,
	HeaderContextMenuResult,
	TabsContextMenuParams,
	TabsContextMenuResult,
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
	addUpstreamRemote,
	cloneRepo,
	commit,
	getChangesetStatus,
	createChangeset,
	removeChangeset,
	continueMerge,
	convertToForkRemotes,
	removeUpstreamRemote,
	createBranch,
	createManagedStash,
	createRepo,
	deleteBranch,
	discardChanges,
	discardManagedStash,
	findManagedStash,
	restoreManagedStash,
	finishStashPop,
	abortStashPop,
	discardLines,
	ensureInitialCommit,
	fetchOrigin,
	fetchPRRef,
	resolveRef,
	refExists,
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
	listCommits,
	listLocalOnlyBranches,
	listChangedFiles,
	mergeBase,
	mergeIntoCurrent,
	updateFromUpstream,
	pinPRBaseRef,
	pull,
	push,
	scanForRepos,
	setOriginAndPush,
	stageFile,
	undoLastCommit
} from '@super-review/core';
import { detectEditors, detectTerminals, openInEditor, openInTerminal } from './editor-service.js';
import { getNpmPackageInfo } from './npm-service.js';
import * as gh from './github-service.js';
import {
	clearSessions,
	countSessions,
	countSessionsAtRef,
	deleteSession,
	getSession,
	getSessionAtRef,
	listSessions,
	listSessionsAtRef,
	watchSessionsDir
} from '@super-review/core';
import {
	addComment,
	deleteComment as deleteCommentRecord,
	editComment,
	listCommentsForContext,
	resolveComment,
	unresolveComment,
	watchCommentsDir
} from '@super-review/core';
import type { LocalComment, LocalCommentAuthor, NewLocalCommentInput } from '@super-review/core';
import { installSkill, isSkillInstalled } from './skill-service.js';
import { listTemplates } from '@super-review/core';
import {
	clearCollapsedFiles,
	clearSeen,
	getBranchBase,
	getCachedFileList,
	getCollapsedFiles,
	getCommitDraft,
	getPrefs,
	getRepo,
	getSeen,
	getSeenSignatures,
	listRepos,
	removeRepo,
	setBranchBase,
	setCachedFileList,
	setCommitDraft,
	setFileCollapsed,
	setPrefs,
	getPRBranch,
	setPRBranch,
	setRepoFork,
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

// MIME types for the image extensions a custom file icon may point at. Anything
// else is rejected so we never inline, say, a multi-megabyte binary as an icon.
const ICON_MIME_BY_EXT: Record<string, string> = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.bmp': 'image/bmp',
	'.avif': 'image/avif'
};

// Cap inlined icons so a misconfigured path can't bloat every file row. 2 MB is
// far larger than any reasonable icon.
const MAX_ICON_BYTES = 2 * 1024 * 1024;

// Resolve a custom-icon source to an `<img>`-ready src for the renderer. `https:`
// and `data:` sources are already allowed by the renderer CSP and pass through;
// an absolute local path to a supported image is read and returned as a data
// URI. Returns null on anything unreadable/unsupported so the renderer falls
// back to the built-in language icon.
async function resolveCustomIcon(rawSource: string): Promise<string | null> {
	const source = (rawSource ?? '').trim();
	if (!source) return null;
	if (source.startsWith('https://') || source.startsWith('data:')) return source;

	let filePath = source;
	if (filePath.startsWith('file://')) {
		try {
			filePath = decodeURI(new URL(filePath).pathname);
		} catch {
			return null;
		}
	}
	// Only inline real files from an absolute path; relative paths have no stable
	// base in the main process and would be a foot-gun.
	if (!path.isAbsolute(filePath)) return null;

	const mime = ICON_MIME_BY_EXT[path.extname(filePath).toLowerCase()];
	if (!mime) return null;

	try {
		const bytes = await readFile(filePath);
		if (bytes.byteLength > MAX_ICON_BYTES) return null;
		return `data:${mime};base64,${bytes.toString('base64')}`;
	} catch {
		return null;
	}
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

// ─── Comments file watcher ──────────────────────────────────────────────────
// The exact same reference-counted, per-repo fs.watch machinery as the session
// watcher above, pointed at .super-review/comments and broadcasting
// `comments:changed`. Kept as a parallel set rather than folded into the session
// watcher so a window can subscribe to either independently.
const commentWatchers = new Map<string, { close: () => void; refs: number }>();
const commentWatchByContents = new Map<number, string>();
const commentWatchHooked = new Set<number>();

function releaseCommentWatch(repoPath: string): void {
	const entry = commentWatchers.get(repoPath);
	if (!entry) return;
	entry.refs -= 1;
	if (entry.refs <= 0) {
		entry.close();
		commentWatchers.delete(repoPath);
	}
}

function setCommentWatch(sender: Electron.WebContents, repoId: string): void {
	const repo = getRepo(repoId);
	if (!repo) return;
	const prev = commentWatchByContents.get(sender.id);
	if (prev === repo.path) return; // Already watching this repo for this window.
	if (prev) releaseCommentWatch(prev);
	commentWatchByContents.set(sender.id, repo.path);

	const entry = commentWatchers.get(repo.path);
	if (entry) {
		entry.refs += 1;
	} else {
		const close = watchCommentsDir(repo.path, () => broadcast('comments:changed', repoId));
		commentWatchers.set(repo.path, { close, refs: 1 });
	}

	if (!commentWatchHooked.has(sender.id)) {
		commentWatchHooked.add(sender.id);
		sender.once('destroyed', () => clearCommentWatch(sender.id));
	}
}

function clearCommentWatch(senderId: number): void {
	const prev = commentWatchByContents.get(senderId);
	if (prev) releaseCommentWatch(prev);
	commentWatchByContents.delete(senderId);
	commentWatchHooked.delete(senderId);
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
			merged.iconDataUrlDark !== previous.iconDataUrlDark ||
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

	// Resolve the History list's commit authors to their GitHub accounts (login +
	// avatar), the way GitHub's own commit list does. No-ops to {} when the repo
	// isn't on GitHub or the account can't be resolved — the renderer falls back
	// to its email heuristic / identicon.
	ipcMain.handle(
		'github:resolveCommitAuthors',
		async (
			_e,
			repoId: string,
			candidates: { email: string; shas: string[] }[]
		): Promise<Record<string, CommitAuthorIdentity>> => {
			const repo = getRepo(repoId);
			if (!repo?.githubOwner || !repo?.githubRepo) return {};
			return gh
				.resolveCommitAuthors(repo.githubOwner, repo.githubRepo, candidates, repo.githubAccountId)
				.catch(() => ({}));
		}
	);

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
			await ensureInitialCommit(
				repo.path,
				'Initial commit',
				gh.resolveCommitIdentity(accountId),
				await gh.resolveCommitSigning(accountId)
			);
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

	ipcMain.handle(
		'git:listLocalOnlyBranches',
		async (_e, repoId: string): Promise<LocalOnlyBranch[]> => {
			return listLocalOnlyBranches(repoOrThrow(repoId).path);
		}
	);

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
			// Sessions are frozen snapshots, not live git state — serve their file
			// list straight from the manifest. `ctx.ref` reads the manifest committed
			// on a branch/PR viewed read-only; otherwise it's on disk.
			if (ctx.kind === 'session') {
				const repoPath = repoOrThrow(repoId).path;
				const session = ctx.ref
					? await getSessionAtRef(repoPath, ctx.ref, ctx.sessionId)
					: await getSession(repoPath, ctx.sessionId);
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

	ipcMain.handle('git:refExists', async (_e, repoId: string, ref: string): Promise<boolean> => {
		return refExists(repoOrThrow(repoId).path, ref);
	});

	ipcMain.handle(
		'git:getDiff',
		async (_e, repoId: string, filePath: string, ctx: DiffContext): Promise<DiffData> => {
			// Session diffs come from the manifest, not git. `ctx.ref` reads the
			// manifest committed on a branch/PR viewed read-only; otherwise on disk.
			if (ctx.kind === 'session') {
				const repoPath = repoOrThrow(repoId).path;
				const session = ctx.ref
					? await getSessionAtRef(repoPath, ctx.ref, ctx.sessionId)
					: await getSession(repoPath, ctx.sessionId);
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
			// Inject the OS-trash implementation: core stays Electron-free, so the
			// app supplies `shell.trashItem` to keep discards of new/untracked files
			// recoverable (move to trash) rather than hard-deleting them.
			discardChanges(repoOrThrow(repoId).path, filePath, oldPath, (p) =>
				import('electron').then(({ shell }) => shell.trashItem(p))
			)
	);

	ipcMain.handle(
		'git:discardLines',
		async (_e, repoId: string, _filePath: string, patch: string): Promise<void> =>
			discardLines(repoOrThrow(repoId).path, patch)
	);

	ipcMain.handle(
		'git:continueMerge',
		async (_e, repoId: string): Promise<PullPushResult> => continueMerge(repoOrThrow(repoId).path)
	);

	ipcMain.handle('git:abortMerge', async (_e, repoId: string): Promise<void> => {
		await abortMerge(repoOrThrow(repoId).path);
	});

	// Stash management. Create/find key off the current branch (one managed stash
	// per branch); restore/discard/finish/abort operate on a resolved SHA the
	// renderer passes back, so they're immune to stash-index shifts.
	ipcMain.handle(
		'git:createManagedStash',
		async (_e, repoId: string): Promise<{ ok: boolean; error?: string }> => {
			const repo = repoOrThrow(repoId);
			const branch = await getCurrentBranch(repo.path);
			if (!branch) return { ok: false, error: 'Not on a branch (detached HEAD).' };
			return createManagedStash(repo.path, branch);
		}
	);

	ipcMain.handle(
		'git:findManagedStash',
		async (_e, repoId: string): Promise<ManagedStash | null> => {
			const repo = repoOrThrow(repoId);
			const branch = await getCurrentBranch(repo.path);
			if (!branch) return null;
			return findManagedStash(repo.path, branch);
		}
	);

	ipcMain.handle(
		'git:restoreManagedStash',
		async (_e, repoId: string, ref: string): Promise<PullPushResult> =>
			restoreManagedStash(repoOrThrow(repoId).path, ref)
	);

	ipcMain.handle(
		'git:discardManagedStash',
		async (_e, repoId: string, ref: string): Promise<void> => {
			await discardManagedStash(repoOrThrow(repoId).path, ref);
		}
	);

	ipcMain.handle(
		'git:finishStashPop',
		async (_e, repoId: string, ref: string): Promise<PullPushResult> =>
			finishStashPop(repoOrThrow(repoId).path, ref)
	);

	ipcMain.handle('git:abortStashPop', async (_e, repoId: string): Promise<void> => {
		await abortStashPop(repoOrThrow(repoId).path);
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
			const signing = await gh.resolveCommitSigning(repo.githubAccountId);
			return commit(repo.path, message, files, identity, signing);
		}
	);

	ipcMain.handle(
		'git:getLastCommit',
		async (_e, repoId: string): Promise<LastCommit | null> =>
			getLastCommit(repoOrThrow(repoId).path)
	);

	ipcMain.handle(
		'git:listCommits',
		async (_e, repoId: string, head?: string, limit?: number): Promise<CommitInfo[]> =>
			listCommits(repoOrThrow(repoId).path, head, limit)
	);

	ipcMain.handle(
		'git:mergeBase',
		async (_e, repoId: string, a: string, b: string): Promise<string | null> =>
			mergeBase(repoOrThrow(repoId).path, a, b)
	);

	ipcMain.handle(
		'git:undoLastCommit',
		async (_e, repoId: string): Promise<CommitResult> => undoLastCommit(repoOrThrow(repoId).path)
	);

	// Convert the project to a fork: repoint `origin` at the freshly-created fork,
	// keep the original repo as `upstream`, and persist the new coordinates. The
	// renderer commits/pushes through the normal path afterward (which now targets
	// the fork). `repoFetchUrl` swaps owner/repo on the existing origin URL so the
	// fork inherits the same SSH/HTTPS auth.
	ipcMain.handle(
		'git:convertToFork',
		async (
			_e,
			repoId: string,
			forkOwner: string,
			forkRepo: string,
			contributeToParent: boolean
		): Promise<RepoInfo> => {
			const repo = repoOrThrow(repoId);
			if (!repo.githubOwner || !repo.githubRepo) {
				throw new Error('This repository does not have a GitHub remote to fork.');
			}
			// Capture the parent before we overwrite githubOwner/githubRepo with the
			// fork. Only wired up as `upstream` when contributing to the parent.
			const parent = { owner: repo.githubOwner, repo: repo.githubRepo };
			const forkUrl = repoFetchUrl(repo, forkOwner, forkRepo);
			const upstreamUrl = contributeToParent
				? (repo.remoteUrl ?? `https://github.com/${parent.owner}/${parent.repo}.git`)
				: null;
			await convertToForkRemotes(repo.path, forkUrl, upstreamUrl);
			const updated = setRepoFork(
				repoId,
				{ owner: forkOwner, repo: forkRepo, url: forkUrl },
				contributeToParent ? parent : null
			);
			if (!updated) throw new Error('Failed to update repository after forking.');
			broadcast('repos:active-changed', updated);
			return updated;
		}
	);

	// Change an existing fork's contribution target. Contributing to the parent
	// wires it up as `upstream` (remote + metadata) so PRs/sync target it; "own
	// purposes" tears the upstream back down. The parent is resolved from the
	// GitHub API since it isn't recorded while in "own purposes" mode.
	ipcMain.handle(
		'git:setForkContribution',
		async (_e, repoId: string, contributeToParent: boolean): Promise<RepoInfo> => {
			const repo = repoOrThrow(repoId);
			if (contributeToParent) {
				if (!repo.githubOwner || !repo.githubRepo) {
					throw new Error('This repository does not have a GitHub remote.');
				}
				const parent = await gh.getUpstream(
					repo.githubOwner,
					repo.githubRepo,
					repo.githubAccountId
				);
				if (!parent) throw new Error('This repository is not a fork, so it has no parent.');
				await addUpstreamRemote(repo.path, repoFetchUrl(repo, parent.owner, parent.repo));
				const updated = setRepoUpstream(repoId, parent);
				if (!updated) throw new Error('Failed to update repository.');
				broadcast('repos:active-changed', updated);
				return updated;
			}
			await removeUpstreamRemote(repo.path);
			const updated = setRepoUpstream(repoId, null);
			if (!updated) throw new Error('Failed to update repository.');
			broadcast('repos:active-changed', updated);
			return updated;
		}
	);

	ipcMain.handle('changesets:getStatus', async (_e, repoId: string): Promise<ChangesetStatus> => {
		return getChangesetStatus(repoOrThrow(repoId).path);
	});

	ipcMain.handle(
		'changesets:create',
		async (_e, repoId: string, input: CreateChangesetInput): Promise<string> => {
			return createChangeset(repoOrThrow(repoId).path, input);
		}
	);

	ipcMain.handle(
		'changesets:remove',
		async (_e, repoId: string, filePath: string): Promise<void> => {
			await removeChangeset(repoOrThrow(repoId).path, filePath);
		}
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
	ipcMain.handle('editor:open', async (_e, editor: EditorKind, target: string, line?: number) =>
		openInEditor(editor, target, line)
	);

	// ─── Terminal ──────────────────────────────────────────────────────────
	ipcMain.handle('terminal:detect', async () => detectTerminals());
	ipcMain.handle('terminal:open', async (_e, terminal: TerminalKind, target: string) =>
		openInTerminal(terminal, target)
	);

	// ─── GitHub ────────────────────────────────────────────────────────────
	// Push auth failures (revoked token / SAML session lapsed) and their
	// recovery to every window so the UI can prompt for a re-sign-in.
	gh.onAuthErrorsChanged((errors) => broadcast('github:auth-changed', errors));
	ipcMain.handle(
		'github:getAuthErrors',
		async (): Promise<GithubAuthError[]> => gh.getAuthErrors()
	);
	ipcMain.handle(
		'github:validateAccounts',
		async (): Promise<GithubAuthError[]> => gh.validateAccounts()
	);
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

	// Whether the project's account can push to `origin`'s repo. False (rather
	// than throwing) when there's no GitHub remote, so the renderer can simply
	// treat false as "offer to fork". null = unknown (transient failure) — the
	// renderer must not offer to fork on it.
	ipcMain.handle(
		'github:getRepoPushAccess',
		async (_e, repoId: string): Promise<boolean | null> => {
			const repo = repoOrThrow(repoId);
			if (!repo.githubOwner || !repo.githubRepo) return false;
			return gh.canPushToRepo(repo.githubOwner, repo.githubRepo, repo.githubAccountId);
		}
	);

	// Fork the project's `origin` repo under the account; returns the fork's
	// owner/name (its name usually matches the parent's).
	ipcMain.handle(
		'github:createFork',
		async (_e, repoId: string): Promise<{ owner: string; repo: string }> => {
			const repo = repoOrThrow(repoId);
			if (!repo.githubOwner || !repo.githubRepo) {
				throw new Error('This repository does not have a GitHub remote to fork.');
			}
			return gh.createFork(repo.githubOwner, repo.githubRepo, repo.githubAccountId);
		}
	);

	// The parent of `origin` if it's a GitHub fork, else null. Pure read — backs
	// the Fork Behavior settings pane (which must know the parent even when the
	// repo is currently set to "for my own purposes" and has no upstream metadata).
	ipcMain.handle(
		'github:getRepoParent',
		async (_e, repoId: string): Promise<{ owner: string; repo: string } | null> => {
			const repo = repoOrThrow(repoId);
			if (!repo.githubOwner || !repo.githubRepo) return null;
			return gh.getUpstream(repo.githubOwner, repo.githubRepo, repo.githubAccountId);
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
			// Where the branch's PR would live, and who owns the branch. For a fork
			// contributing to its parent, the PR is opened on the upstream with the
			// head qualified by the fork owner (`fork:branch`); otherwise it's a PR
			// within the repo's own remote. Try the host first, then fall back to the
			// fork's own repo (covers a fork with a self-targeted PR).
			const headOwner = repo.githubOwner;
			const bases: { owner: string; repo: string }[] = [];
			if (repo.upstreamOwner && repo.upstreamRepo) {
				bases.push({ owner: repo.upstreamOwner, repo: repo.upstreamRepo });
			}
			bases.push({ owner: repo.githubOwner, repo: repo.githubRepo });
			for (const base of bases) {
				try {
					const pr = await gh.findPRForBranch(
						base.owner,
						base.repo,
						headOwner,
						branch,
						repo.githubAccountId
					);
					if (pr) return pr;
				} catch (err) {
					console.error(
						`[github] findPRForBranch failed for base=${base.owner}/${base.repo} ` +
							`head=${headOwner}:${branch} pinnedAccountId=${repo.githubAccountId ?? '(none)'}:`,
						err instanceof Error ? err.message : err
					);
				}
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
		async (_e, repoId: string, pr: PRSummary): Promise<boolean | null> => {
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
				// Couldn't even start the check (e.g. signed out) — unknown.
				return null;
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
			const empty: PRChecksSummary = { state: 'none', checks: [], deployments: [] };
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
			// Anchor the comment to the exact commit the on-screen diff was rendered
			// from. The renderer passes that view's head ref (`input.headRef`):
			// `pr/<n>/head` for a PR view, or the branch tip for a Branch view. On the
			// Branch tab the branch tip (once pushed) IS the PR's live head, so the
			// comment isn't born "Outdated" — anchoring to the `pr/<n>/head` snapshot
			// instead lags commits pushed since the PR was last fetched. Fall back to
			// the snapshot when the renderer didn't supply a ref. Null when neither
			// resolves (e.g. an unpushed branch), in which case the service falls back
			// to the PR's live head.
			const anchorRef = input.headRef ?? `pr/${input.prNumber}/head`;
			const snapshotSha = await resolveRef(repo.path, anchorRef);
			return gh.createReviewComment(owner, name, input, repo.githubAccountId, snapshotSha);
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
		'github:updateReviewComment',
		async (
			_e,
			repoId: string,
			commentId: number,
			body: string,
			prOwner?: string,
			prRepo?: string
		): Promise<string> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.updateReviewComment(owner, name, commentId, body, repo.githubAccountId);
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

	ipcMain.handle(
		'github:listConversation',
		async (
			_e,
			repoId: string,
			prNumber: number,
			prOwner?: string,
			prRepo?: string
		): Promise<PRConversationItem[]> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.listConversation(owner, name, prNumber, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:createIssueComment',
		async (
			_e,
			repoId: string,
			prNumber: number,
			body: string,
			prOwner?: string,
			prRepo?: string
		): Promise<PRConversationItem> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.createIssueComment(owner, name, prNumber, body, repo.githubAccountId);
		}
	);

	ipcMain.handle('feedback:submit', async (_e, input: FeedbackInput): Promise<FeedbackResult> => {
		return gh.createFeedbackIssue(input, {
			appVersion: app.getVersion(),
			platform: process.platform,
			osRelease: os.release()
		});
	});

	ipcMain.handle(
		'github:deleteIssueComment',
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
			await gh.deleteIssueComment(owner, name, commentId, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:updateIssueComment',
		async (
			_e,
			repoId: string,
			commentId: number,
			body: string,
			prOwner?: string,
			prRepo?: string
		): Promise<string> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.updateIssueComment(owner, name, commentId, body, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:updatePullRequestBody',
		async (
			_e,
			repoId: string,
			prNumber: number,
			body: string,
			prOwner?: string,
			prRepo?: string
		): Promise<string> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.updatePullRequestBody(owner, name, prNumber, body, repo.githubAccountId);
		}
	);

	ipcMain.handle(
		'github:mergePullRequest',
		async (
			_e,
			repoId: string,
			prNumber: number,
			method: PRMergeMethod,
			prOwner?: string,
			prRepo?: string,
			commitTitle?: string,
			commitMessage?: string
		): Promise<PRMergeResult> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			return gh.mergePullRequest(
				owner,
				name,
				prNumber,
				method,
				repo.githubAccountId,
				commitTitle,
				commitMessage
			);
		}
	);

	ipcMain.handle(
		'github:markPullRequestReady',
		async (
			_e,
			repoId: string,
			prNumber: number,
			prOwner?: string,
			prRepo?: string
		): Promise<void> => {
			const repo = repoOrThrow(repoId);
			const owner = prOwner ?? repo.githubOwner;
			const name = prRepo ?? repo.githubRepo;
			if (!owner || !name) {
				throw new Error('This repository does not have a GitHub remote.');
			}
			await gh.markPullRequestReady(owner, name, prNumber, repo.githubAccountId);
		}
	);

	// ─── npm ───────────────────────────────────────────────────────────────
	// Trimmed npm-registry metadata for the package.json hover cards. Cached in
	// npm-service; resolves to an error variant rather than throwing.
	ipcMain.handle('npm:getPackageInfo', async (_e, name: string): Promise<NpmPackageResult> => {
		return getNpmPackageInfo(name);
	});

	// GitHub release notes for a package version (the hover card's "What's new"
	// disclosure). Resolves `{ release: null }` for non-GitHub repos / no matching
	// release, and an error variant rather than throwing.
	ipcMain.handle(
		'npm:getReleaseNotes',
		async (
			_e,
			repositoryUrl: string,
			packageName: string,
			version: string
		): Promise<ReleaseNotesResult> => {
			return gh.getReleaseNotes(repositoryUrl, packageName, version);
		}
	);

	// Release notes for every release between two versions (a dep that changed in
	// the diff). Newest-first; resolves an empty/error variant rather than throwing.
	ipcMain.handle(
		'npm:getReleaseNotesRange',
		async (
			_e,
			repositoryUrl: string,
			packageName: string,
			fromVersion: string,
			toVersion: string
		): Promise<ReleaseNotesRangeResult> => {
			return gh.getReleaseNotesRange(repositoryUrl, packageName, fromVersion, toVersion);
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
				groups.push([
					item(`Mark ${n} Selected Files as Seen`, 'markSelectedSeen'),
					item(`Mark ${n} Selected Files as Unseen`, 'markSelectedUnseen')
				]);
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

	// Pop up the staging gutter's native discard menu and resolve with the chosen
	// action. The renderer builds the discard patch and applies it (so it can
	// refresh afterward); we only render the menu. Discarding is recoverable (the
	// lines remain in HEAD), so — like the file discard — no extra confirm.
	ipcMain.handle(
		'menu:showDiffLineContextMenu',
		async (e, params: DiffLineContextMenuParams): Promise<DiffLineContextMenuAction | null> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			let chosen: DiffLineContextMenuAction | null = null;
			const label = params.scope === 'lines' ? 'Discard modified lines' : 'Discard modified line';
			const template: MenuItemConstructorOptions[] = [
				{
					label,
					click: () => {
						chosen = 'discard';
					}
				}
			];

			const menu = Menu.buildFromTemplate(template);
			return await new Promise<DiffLineContextMenuAction | null>((resolve) => {
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

			const template: MenuItemConstructorOptions[] = [];
			// Read-only view: show the branch's committed state without checking it
			// out, leaving the working tree where it is.
			if (params.canView) {
				template.push(item('View Read-Only', 'view'));
				template.push({ type: 'separator' });
			}
			template.push(item('Copy Branch Name', 'copy'));
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

	// Pull-request row context menu (in the branch picker's PRs tab). Mirrors the
	// branch menu: "View Read-Only" opens the PR's diff without checking out; the
	// renderer handles copy/open with the PR it already holds.
	ipcMain.handle(
		'menu:showPRContextMenu',
		async (e, params: PRContextMenuParams): Promise<PRContextMenuAction | null> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			let chosen: PRContextMenuAction | null = null;
			const item = (label: string, action: PRContextMenuAction): MenuItemConstructorOptions => ({
				label,
				click: () => {
					chosen = action;
				}
			});

			const template: MenuItemConstructorOptions[] = [];
			if (params.canView) {
				template.push(item('View Read-Only', 'view'));
				template.push({ type: 'separator' });
			}
			template.push(item('Copy Link', 'copyUrl'));
			template.push(item('Open on GitHub', 'openOnGitHub'));

			const menu = Menu.buildFromTemplate(template);
			return await new Promise<PRContextMenuAction | null>((resolve) => {
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
				item('Repository Settings…', 'settings'),
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

	// Commit row context menu (right-click a row in the History list). Offers
	// copying the abbreviated or full commit hash; the renderer performs the copy.
	ipcMain.handle(
		'menu:showCommitContextMenu',
		async (e): Promise<CommitContextMenuAction | null> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			let chosen: CommitContextMenuAction | null = null;
			const item = (
				label: string,
				action: CommitContextMenuAction
			): MenuItemConstructorOptions => ({
				label,
				click: () => {
					chosen = action;
				}
			});

			const menu = Menu.buildFromTemplate([
				item('Copy Short Hash', 'copyShortHash'),
				item('Copy Full Hash', 'copyFullHash')
			]);
			return await new Promise<CommitContextMenuAction | null>((resolve) => {
				menu.popup({
					window: win ?? undefined,
					callback: () => resolve(chosen)
				});
			});
		}
	);

	// Header "Show in header" customization menu (right-click anywhere on the top
	// bar). Native checkbox items reflecting each optional control's visibility;
	// the renderer persists the toggle. A native menu closes on each click, so we
	// return the single item that was toggled and its new state.
	ipcMain.handle(
		'menu:showHeaderContextMenu',
		async (e, params: HeaderContextMenuParams): Promise<HeaderContextMenuResult> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			let chosen: HeaderContextMenuResult = null;
			const template: MenuItemConstructorOptions[] = params.items.map(
				(it): MenuItemConstructorOptions => ({
					label: it.label,
					type: 'checkbox',
					checked: it.checked,
					click: (menuItem) => {
						chosen = { key: it.key, checked: menuItem.checked };
					}
				})
			);

			const menu = Menu.buildFromTemplate(template);
			return await new Promise<HeaderContextMenuResult>((resolve) => {
				menu.popup({
					window: win ?? undefined,
					callback: () => resolve(chosen)
				});
			});
		}
	);

	// The sidebar tab strip's "Show tab" menu. Same shape as the header menu: a
	// checkbox per optional tab; the chosen item and its new state come back.
	ipcMain.handle(
		'menu:showTabsContextMenu',
		async (e, params: TabsContextMenuParams): Promise<TabsContextMenuResult> => {
			const win = BrowserWindow.fromWebContents(e.sender);
			let chosen: TabsContextMenuResult = null;
			const template: MenuItemConstructorOptions[] = params.items.map(
				(it): MenuItemConstructorOptions => ({
					label: it.label,
					type: 'checkbox',
					checked: it.checked,
					click: (menuItem) => {
						chosen = { key: it.key, checked: menuItem.checked };
					}
				})
			);

			const menu = Menu.buildFromTemplate(template);
			return await new Promise<TabsContextMenuResult>((resolve) => {
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

	// ─── Icons ─────────────────────────────────────────────────────────────
	ipcMain.handle(
		'icons:resolveCustomIcon',
		async (_e, source: string): Promise<string | null> => resolveCustomIcon(source)
	);

	ipcMain.handle('icons:pickIconFile', async (e): Promise<string | null> => {
		const win = BrowserWindow.fromWebContents(e.sender);
		const opts: Electron.OpenDialogOptions = {
			title: 'Choose an icon image',
			properties: ['openFile'],
			// Same image types resolveCustomIcon will accept (extensions without the dot).
			filters: [
				{ name: 'Images', extensions: Object.keys(ICON_MIME_BY_EXT).map((ext) => ext.slice(1)) }
			]
		};
		const result = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0];
	});

	ipcMain.handle(
		'state:getSeenFiles',
		async (_e, repoId: string, contextKey: string): Promise<string[]> => {
			return getSeen(repoId, contextKey);
		}
	);

	ipcMain.handle(
		'state:getSeenSignatures',
		async (_e, repoId: string, contextKey: string): Promise<Record<string, string>> => {
			return getSeenSignatures(repoId, contextKey);
		}
	);

	ipcMain.handle(
		'state:setFileSeen',
		async (
			_e,
			repoId: string,
			contextKey: string,
			filePath: string,
			seen: boolean,
			sig?: string
		) => {
			setSeen(repoId, contextKey, filePath, seen, sig);
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
		'state:getCachedFileList',
		async (_e, repoId: string, contextKey: string): Promise<ChangedFile[]> => {
			return getCachedFileList(repoId, contextKey);
		}
	);

	ipcMain.handle(
		'state:setCachedFileList',
		async (_e, repoId: string, contextKey: string, files: ChangedFile[]) => {
			setCachedFileList(repoId, contextKey, files);
		}
	);

	ipcMain.handle(
		'state:getBranchBase',
		async (_e, repoId: string, branch: string): Promise<string | null> => {
			return getBranchBase(repoId, branch);
		}
	);

	ipcMain.handle(
		'state:setBranchBase',
		async (_e, repoId: string, branch: string, base: string | null) => {
			setBranchBase(repoId, branch, base);
		}
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

	// A `ref` reads the sessions committed on that git ref (a branch/PR being
	// reviewed read-only) rather than the working tree, so the list matches the
	// branch being viewed instead of the checked-out one. Null/omitted = disk.
	ipcMain.handle(
		'sessions:list',
		async (_e, repoId: string, ref?: string | null): Promise<SessionSummary[]> => {
			const repoPath = repoOrThrow(repoId).path;
			return ref ? listSessionsAtRef(repoPath, ref) : listSessions(repoPath);
		}
	);

	ipcMain.handle(
		'sessions:get',
		async (_e, repoId: string, id: string, ref?: string | null): Promise<Session | null> => {
			const repoPath = repoOrThrow(repoId).path;
			return ref ? getSessionAtRef(repoPath, ref, id) : getSession(repoPath, id);
		}
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
		async (_e, repoId: string, ref?: string | null): Promise<number> => {
			const repoPath = repoOrThrow(repoId).path;
			return ref ? countSessionsAtRef(repoPath, ref) : countSessions(repoPath);
		}
	);

	// Start/stop live session updates for the calling window's active repo. A null
	// repoId (or unwatch) tears down this window's watch.
	ipcMain.handle('sessions:watch', (e, repoId: string | null): void => {
		if (repoId) setSessionWatch(e.sender, repoId);
		else clearSessionWatch(e.sender.id);
	});

	ipcMain.handle('sessions:unwatch', (e): void => clearSessionWatch(e.sender.id));

	// ─── Local comments ──────────────────────────────────────────────────────
	// Comments live in a git-ignored SQLite DB (.super-review/comments.db), so —
	// unlike sessions — there's no committed-on-a-ref variant; they're always read
	// from the local database for the given diff context.
	ipcMain.handle(
		'comments:list',
		async (_e, repoId: string, contextKey: string): Promise<LocalComment[]> =>
			listCommentsForContext(repoOrThrow(repoId).path, contextKey)
	);

	ipcMain.handle(
		'comments:add',
		async (_e, repoId: string, input: NewLocalCommentInput): Promise<LocalComment> =>
			addComment(repoOrThrow(repoId).path, input)
	);

	ipcMain.handle(
		'comments:edit',
		async (_e, repoId: string, id: string, body: string): Promise<LocalComment | null> =>
			editComment(repoOrThrow(repoId).path, id, body)
	);

	ipcMain.handle(
		'comments:resolve',
		async (
			_e,
			repoId: string,
			id: string,
			resolver: LocalCommentAuthor,
			sessionId?: string | null
		): Promise<LocalComment | null> =>
			resolveComment(repoOrThrow(repoId).path, id, resolver, sessionId ?? null)
	);

	ipcMain.handle(
		'comments:unresolve',
		async (_e, repoId: string, id: string): Promise<LocalComment | null> =>
			unresolveComment(repoOrThrow(repoId).path, id)
	);

	ipcMain.handle(
		'comments:remove',
		async (_e, repoId: string, id: string): Promise<void> =>
			deleteCommentRecord(repoOrThrow(repoId).path, id)
	);

	ipcMain.handle('comments:watch', (e, repoId: string | null): void => {
		if (repoId) setCommentWatch(e.sender, repoId);
		else clearCommentWatch(e.sender.id);
	});

	ipcMain.handle('comments:unwatch', (e): void => clearCommentWatch(e.sender.id));

	// ─── Skill ─────────────────────────────────────────────────────────────
	// The super-review skill teaches an agent how/when to record a session and
	// resolve review comments.
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
