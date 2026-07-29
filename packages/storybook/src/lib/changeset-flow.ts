/**
 * Stands in for the main process so the changeset-generation flow runs end to
 * end in Storybook: clicking the sparkle on the "Add a changeset?" notice starts
 * a run, the row shimmers for as long as a real CLI would take, and the files it
 * "writes" clear the prompt.
 *
 * The real path is renderer → `window.api.changesets.generate` → a harness CLI →
 * `.changeset/*.md` on disk → a file refresh that re-reads the status. Only the
 * middle is faked: the store action, the notice, and the refresh that follows are
 * the app's own. Alongside `changesets`, the calls that refresh makes are stubbed
 * with empty answers, since Storybook's blanket api stub resolves everything to
 * `undefined` and the refresh would fail on it.
 */
import { app } from '@super-review/ui/store.svelte';
import type {
	ChangesetProgressEvent,
	ChangesetStatus,
	GenerateChangesetResult
} from '@super-review/core/types';

/** How long the mocked CLI "works" before it has written everything. */
export const DEFAULT_RUN_MS = 12_000;

// What a real run's tool calls read like, in the order they tend to arrive: the
// agent orients itself, reads the branch, then writes. The notice shows the
// latest one, so this is the whole point of a long run being watchable.
const ACTIVITY = [
	'Running git log',
	'Running git diff',
	'Reading CommitNotices.svelte',
	'Searching for changesetGenerating',
	'Reading store.svelte.ts',
	'Running git status',
	'Reading changeset.ts',
	'Writing brave-otters-jog.md'
];

const PACKAGES: ChangesetStatus['packages'] = [
	{ name: '@super-review/core', dir: 'packages/core', private: false },
	{ name: '@super-review/ui', dir: 'packages/ui', private: false }
];

/** The branch before any changeset covers it: the state the prompt reacts to. */
export function pendingStatus(): ChangesetStatus {
	return {
		installed: true,
		packages: PACKAGES,
		changedPackages: ['@super-review/ui'],
		coveredPackages: [],
		needsChangeset: true,
		branchChangesets: []
	};
}

/** The branch after the run: covered by the changeset the agent just wrote. */
function coveredStatus(path: string): ChangesetStatus {
	return {
		installed: true,
		packages: PACKAGES,
		changedPackages: ['@super-review/ui'],
		coveredPackages: ['@super-review/ui'],
		needsChangeset: false,
		branchChangesets: [{ path, packages: ['@super-review/ui'], added: true }]
	};
}

// Renderer-side listeners on events.onChangesetProgress, fed by the fake run.
const activityListeners = new Set<(event: ChangesetProgressEvent) => void>();
let activityTimer: ReturnType<typeof setTimeout> | undefined;

function streamActivity(totalMs: number): void {
	const step = Math.max(400, Math.floor(totalMs / (ACTIVITY.length + 1)));
	let index = 0;
	const tick = (): void => {
		if (index >= ACTIVITY.length) return;
		const status = ACTIVITY[index++]!;
		for (const listener of activityListeners) listener({ status });
		activityTimer = setTimeout(tick, step);
	};
	activityTimer = setTimeout(tick, step);
}

function stopActivity(): void {
	if (activityTimer) clearTimeout(activityTimer);
	activityTimer = undefined;
}

let runMs = DEFAULT_RUN_MS;
let status: ChangesetStatus = pendingStatus();
let installed = false;
// Set while a run is in flight; calling it ends the wait early as a cancel.
let abortRun: (() => void) | null = null;

/** Point the mock back at an un-covered branch so the flow can be replayed. */
export function resetChangesetFlow(): void {
	stopActivity();
	status = pendingStatus();
	app.changesetStatus = status;
	app.changesetGenerating = false;
	app.changesetPromptDismissed = false;
}

/** Wire the run duration to the story's args. */
export function setChangesetRunMs(ms: number): void {
	runMs = ms;
}

// One timer for the whole run (not a poll loop — background tabs throttle
// timers, which would stretch a 3s run into a minute). Resolves true if the run
// was cancelled before it elapsed.
function waitOut(ms: number): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			abortRun = null;
			resolve(false);
		}, ms);
		abortRun = () => {
			clearTimeout(timer);
			abortRun = null;
			resolve(true);
		};
	});
}

const changesetsMock = {
	async getStatus(): Promise<ChangesetStatus> {
		return status;
	},
	async generate(): Promise<GenerateChangesetResult> {
		streamActivity(runMs);
		const cancelled = await waitOut(runMs);
		stopActivity();
		if (cancelled) {
			return { ok: false, code: 'cancelled', error: 'Cancelled' };
		}
		const path = '.changeset/brave-otters-jog.md';
		status = coveredStatus(path);
		// In the app the new status arrives via the file refresh that follows a run;
		// here that refresh runs against stub data, so publish it directly and keep
		// the story's end state honest either way.
		app.changesetStatus = status;
		return {
			ok: true,
			harness: 'claude-code',
			written: [
				{
					path,
					packages: ['@super-review/ui'],
					summary: 'feat(changesets): generate a changeset from the commit-box notice'
				}
			]
		};
	},
	async cancelGenerate(): Promise<boolean> {
		stopActivity();
		if (!abortRun) return false;
		abortRun();
		return true;
	},
	async create(): Promise<string> {
		return '.changeset/manual-otters-jog.md';
	},
	async remove(): Promise<void> {}
};

export function installChangesetMock(): void {
	if (installed || typeof window === 'undefined') return;
	installed = true;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as any;
	const base = w.api;

	// What refreshFiles() reads after the run. Empty answers are enough: the story
	// renders the notice, not the file list.
	const git = new Proxy(
		{},
		{
			get: (_t, prop) =>
				prop === 'listChangedFiles' ? async () => [] : (base?.git?.[prop] ?? (() => undefined))
		}
	);
	const stateStubs: Record<string, () => Promise<unknown>> = {
		getSeenFiles: async () => [],
		getSeenSignatures: async () => ({}),
		getCollapsedFiles: async () => [],
		getCachedFileList: async () => null,
		getRetainedSeen: async () => []
	};
	const state = new Proxy(
		{},
		{
			get: (_t, prop) =>
				stateStubs[prop as string] ?? base?.state?.[prop as string] ?? (() => undefined)
		}
	);

	// The store subscribes to activity through events.onChangesetProgress; the
	// rest of the event surface falls through to the blanket stub.
	const events = new Proxy(
		{},
		{
			get(_t, prop) {
				if (prop !== 'onChangesetProgress') return base?.events?.[prop];
				return (handler: (event: ChangesetProgressEvent) => void) => {
					activityListeners.add(handler);
					return () => activityListeners.delete(handler);
				};
			}
		}
	);

	w.api = new Proxy(base ?? {}, {
		get(target, prop) {
			if (prop === 'changesets') return changesetsMock;
			if (prop === 'events') return events;
			if (prop === 'git') return git;
			if (prop === 'state') return state;
			return Reflect.get(target, prop);
		}
	});
}
