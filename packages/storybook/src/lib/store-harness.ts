/**
 * The "critical" components (file tree, diff view, branch picker, repo picker)
 * read from the single global `app` store rather than props, so stories drive
 * them by seeding that store. `seedStore` first resets every field a story is
 * likely to touch back to an empty default, then applies the story's overrides
 * — Storybook keeps one preview document alive across stories, so without the
 * reset, state from the previously viewed story would bleed through.
 */
import { app, setCachedDiff } from '@super-review/ui/store.svelte';
import { SvelteSet, SvelteMap } from 'svelte/reactivity';
import type { DiffContext } from '@super-review/core/types';
import type { ChangedFile, DiffData } from '@super-review/core/types';
import { makeDiffData } from './fixtures';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type App = typeof app & Record<string, any>;

const WORKING_TREE: DiffContext = { kind: 'workingTree' };

/** The subset of store fields the stories populate, reset before each seed. */
function resetTouchedFields() {
	const a = app as App;
	a.repos = [];
	a.activeRepo = null;
	a.branches = [];
	a.currentBranch = null;
	a.viewBranch = null;
	a.viewPR = null;
	a.viewBranchPR = null;
	a.branchPR = null;
	a.prs = [];
	a.prsHasMore = false;
	a.prsSource = 'fork';
	a.commits = [];
	a.activeCommit = null;
	a.changedFiles = [];
	a.selectedFile = null;
	a.fileSearchQuery = '';
	a.contextTab = 'branch';
	a.diffContext = WORKING_TREE;
	a.diffLayout = 'scroll';
	a.viewMode = 'split';
	a.showFileIcons = true;
	a.indentGuides = true;
	a.recentRepoCount = 5;
	a.loading = false;
	a.githubAccounts = [];
	a.activeGithubAccount = null;
	// Reactive collections must be fresh instances so old entries don't linger.
	a.selectedFiles = new SvelteSet<string>();
	a.seenFiles = new SvelteSet<string>();
	a.collapsedFiles = new SvelteSet<string>();
	a.collapsedFolders = new SvelteSet<string>();
	a.excludedFromCommit = new SvelteSet<string>();
	a.stagingLineExclusions = new SvelteSet<string>();
	a.dirtyRepoIds = new SvelteSet<string>();
	a.pendingComposers = {};
	a.localComposers = new SvelteMap();
}

/** Reset the store, then shallow-merge the story's overrides onto it. */
export function seedStore(overrides: Partial<App> = {}): void {
	resetTouchedFields();
	Object.assign(app, overrides);
}

/**
 * Pre-populate the diff cache for the given files in the working-tree context
 * (DiffView/DiffFileSection read from this cache before falling back to the
 * Electron backend, which Storybook doesn't have). Sizes the synthetic patch by
 * the file's additions so big files get big diffs.
 */
export function seedDiffCache(
	repoId: string,
	files: ChangedFile[],
	ctx: DiffContext = WORKING_TREE
): void {
	for (const file of files) {
		if (file.isBinary) continue;
		const lines = Math.min(Math.max(file.additions + file.deletions, 6), 1500);
		const data: DiffData = makeDiffData(file, lines);
		setCachedDiff(repoId, ctx, file.path, data);
	}
}

export { app };
