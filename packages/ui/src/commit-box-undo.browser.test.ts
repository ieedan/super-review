import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CommitBox from '@super-review/ui/components/CommitBox.svelte';
import { app, actions } from '@super-review/ui/store.svelte';
import type { LastCommit, RepoInfo } from '@super-review/core/types';

// The undo row used to appear, vanish and reappear during a single Undo: the
// store flips `push.stage` to 'done' the moment git returns, well before the
// refreshes behind it replace `app.lastCommit`, so a row bound straight to the
// store thrashed the layout. CommitBox holds the last settled commit for the
// duration instead. Runs in a real browser so the assertion is about actual DOM
// mutations, which is the thing the user sees.

const repo: RepoInfo = {
	id: 'r1',
	path: '/tmp/r1',
	name: 'hello',
	lastOpenedAt: 0
};

function commit(subject: string, canUndo: boolean): LastCommit {
	return { hash: subject, subject, body: '', relativeTime: '1 minute ago', canUndo };
}

const idle = { inProgress: false, stage: 'idle', intent: 'push', op: 'push', error: null } as const;

// Mirrors the real store action's sequence — the ordering is the whole point of
// the test, so it's spelled out rather than mocked away wholesale. The long tail
// stands in for the refresh chain (files, branches, push status, and a GitHub PR
// lookup); the row must not wait on it.
const TAIL_MS = 200;

function fakeUndo(settleTo: LastCommit | null) {
	return async (): Promise<boolean> => {
		app.push = { inProgress: true, stage: 'committing', intent: 'push', op: 'commit', error: null };
		await sleep(10); // the git round-trip
		app.lastCommit = settleTo; // <- the new HEAD, published by the action itself
		app.push.stage = 'done'; // <- flips `busy` false while the refreshes are still out
		await sleep(TAIL_MS); // <- the refresh chain
		app.push.inProgress = false;
		return true;
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Every appearance/disappearance of the undo row, in order.
function watchUndoRow(container: HTMLElement): { transitions: boolean[]; stop: () => void } {
	const present = () =>
		[...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Undo');
	const transitions: boolean[] = [];
	let last = present();
	const observer = new MutationObserver(() => {
		const now = present();
		if (now !== last) {
			transitions.push(now);
			last = now;
		}
	});
	observer.observe(container, { childList: true, subtree: true });
	return { transitions, stop: () => observer.disconnect() };
}

const realUndo = actions.undoLastCommit;

beforeEach(() => {
	app.activeRepo = repo;
	app.currentBranch = 'main';
	app.changedFiles = [];
	app.push = { ...idle };
	app.lastCommit = commit('feat: the one being undone', true);
	(window as unknown as { api: unknown }).api = {
		state: {
			getCommitDraft: vi.fn(async () => ({ summary: '', description: '' })),
			setCommitDraft: vi.fn(async () => {})
		}
	};
});

afterEach(() => {
	actions.undoLastCommit = realUndo;
	app.activeRepo = null;
	app.lastCommit = null;
	app.push = { ...idle };
	vi.clearAllMocks();
});

describe('CommitBox undo row', () => {
	it('stays put while the undo runs when another commit is undoable', async () => {
		const next = commit('chore: the one before it', true);
		actions.undoLastCommit = fakeUndo(next);
		const { container } = render(CommitBox);
		await sleep(20);

		const watch = watchUndoRow(container as HTMLElement);
		const button = [...container.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Undo'
		);
		const done = button?.click();
		// Well before the refresh chain finishes: the row already shows the commit
		// the undo exposed rather than sitting on the undone one.
		await sleep(60);
		expect(container.textContent).toContain('chore: the one before it');
		expect(container.textContent).not.toContain('feat: the one being undone');

		await done;
		await sleep(TAIL_MS);
		watch.stop();

		// Never unmounted: the row swapped its text in place.
		expect(watch.transitions).toEqual([]);
		expect(container.textContent).toContain('chore: the one before it');
	});

	it('disappears exactly once when nothing is left to undo', async () => {
		actions.undoLastCommit = fakeUndo(null);
		const { container } = render(CommitBox);
		await sleep(20);

		const watch = watchUndoRow(container as HTMLElement);
		const button = [...container.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Undo'
		);
		button?.click();
		// Gone as soon as git reported the unborn HEAD, not after the refreshes.
		await sleep(60);
		expect(watch.transitions).toEqual([false]);

		await sleep(TAIL_MS);
		watch.stop();
		expect(watch.transitions).toEqual([false]);
	});
});
