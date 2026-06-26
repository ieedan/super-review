import { app, setCachedDiff } from '@super-review/ui/store.svelte';
import { initDiffWorkerPool } from '@super-review/ui/diff-worker-pool';
import type { LocalComment } from '@super-review/core/types';
import { REPO, CTX, MOCK_FILES, MOCK_DIFFS, SEEN_FILE, SEED_COMMENT } from './mock-data';

// Boots the real desktop components against a mock store + a stubbed window.api,
// so the marketing demos ARE the app — same FileList / DiffFileSection, fully
// interactive (mark seen, collapse, list/tree, comment). Runs once, client-only.

let booted = false;

// A deep, callable Proxy: every namespace/method the store reaches for resolves
// to an async no-op, except the handful we implement. This lets the real actions
// run (they mutate the store optimistically, then persist through window.api,
// which we simply swallow) without stubbing the entire Electron preload surface.
function installMockApi(): void {
	const byPath = new Map(MOCK_DIFFS.map((d) => [d.file.path, d]));
	let commentSeq = 0;

	const asyncNoop = (): Promise<undefined> => Promise.resolve(undefined);
	const branch = (overrides: Record<string, unknown> = {}): unknown =>
		new Proxy(asyncNoop as object, {
			get(_t, prop) {
				if (typeof prop === 'string' && prop in overrides) return overrides[prop];
				return branch();
			},
			apply: () => Promise.resolve(undefined)
		});

	const api = branch({
		platform: 'darwin',
		git: branch({
			// Return the same DiffData the section already cached so its background
			// revalidate is a no-op (matching contents → no re-render).
			getDiff: async (_repoId: string, path: string) => byPath.get(path) ?? null
		}),
		state: branch({
			// Return the patch as the "new prefs" so `app.prefs = await setPrefs(...)`
			// never lands undefined; the individual app fields are already set
			// optimistically by the action.
			setPrefs: async (patch: Record<string, unknown>) => ({ ...patch }),
			getPrefs: async () => ({}),
			setFileSeen: asyncNoop,
			setFilesCollapsed: asyncNoop,
			setFileCollapsed: asyncNoop,
			getSeenFiles: async () => [],
			getCollapsedFiles: async () => []
		}),
		comments: branch({
			// Materialize the comment the composer just submitted so it shows up.
			add: async (
				_repoId: string,
				input: Omit<LocalComment, 'id' | 'createdAt' | 'updatedAt'>
			): Promise<LocalComment> => ({
				...input,
				id: `demo-comment-${++commentSeq}`,
				createdAt: Date.now(),
				updatedAt: Date.now()
			}),
			list: async () => [],
			remove: asyncNoop,
			update: asyncNoop
		})
	});

	(window as unknown as { api: unknown }).api = api;
}

export function bootDemo(): void {
	if (booted || typeof window === 'undefined') return;
	booted = true;

	installMockApi();
	initDiffWorkerPool();

	app.activeRepo = REPO as never;
	app.platform = 'darwin';
	app.diffContext = CTX as never;
	// Branch tab: file rows show the green "seen" checkmark (the unstaged tab shows
	// commit-inclusion checkboxes + a commit box instead).
	app.contextTab = 'branch';
	app.theme = 'dark';
	app.viewMode = 'unified';
	app.diffLayout = 'scroll';
	app.showFileIcons = true;
	app.sidebarTabs = { sessions: false, history: false };
	// Hide the "collapse all seen" control; keep the list/tree toggle.
	app.sidebarControls = { collapseSeen: false, viewToggle: true };
	app.changedFiles = MOCK_FILES as never;

	// Attribute comments to a real GitHub identity (avatar + handle) instead of the
	// anonymous "You" — both the seeded comment and any the visitor adds.
	const account = {
		id: 'gh-ieedan',
		login: 'ieedan',
		avatarUrl: 'https://github.com/ieedan.png',
		addedAt: 0
	};
	app.githubAccounts = [account] as never;
	app.activeGithubAccount = account as never;

	// Pre-mark the lead file of the "mark as seen" demo seen + collapsed, so it opens
	// with a reviewed (collapsed) file above the unreviewed ones, and it reads as
	// checked in the sidebar too.
	app.seenFiles.add(SEEN_FILE);
	app.collapsedFiles.add(SEEN_FILE);

	// Seed the (real) PR review comment so the comments demo shows the thread
	// straight away; visitors can still click any line to add their own.
	const now = Date.now();
	const { ageMs, resolvedAgeMs, ...comment } = SEED_COMMENT;
	app.localComments = [
		{
			...comment,
			createdAt: now - ageMs,
			updatedAt: now - ageMs,
			// Resolved by Claude Code a few minutes after it was left, so the demo
			// shows the "Resolved by Claude Code" footer + harness logo.
			resolvedAt: now - resolvedAgeMs
		}
	];

	for (const d of MOCK_DIFFS) setCachedDiff(REPO.id, CTX as never, d.file.path, d);
}
