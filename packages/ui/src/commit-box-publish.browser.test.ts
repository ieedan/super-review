import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CommitBox from '@super-review/ui/components/CommitBox.svelte';
import { app } from '@super-review/ui/store.svelte';
import type { ChangedFile, RepoInfo } from '@super-review/core/types';

// Publishing a repo that has no commits makes the initial commit itself, and it
// used to name that commit "Initial commit" regardless of what the user had
// typed. The box now mirrors its message into the store for the publish to use,
// and empties itself once the publish has committed it.

const repo: RepoInfo = {
	id: 'r1',
	path: '/tmp/r1',
	name: 'hello',
	lastOpenedAt: 0
};

const file: ChangedFile = { path: 'README.md', status: 'untracked' };

const idle = { inProgress: false, stage: 'idle', intent: 'push', op: 'push', error: null } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
}

let setCommitDraft: ReturnType<typeof vi.fn>;

beforeEach(() => {
	app.activeRepo = repo;
	app.currentBranch = 'main';
	app.changedFiles = [file];
	app.push = { ...idle };
	app.lastCommit = null;
	app.commitDraft = { summary: '', description: '' };
	setCommitDraft = vi.fn(async () => {});
	(window as unknown as { api: unknown }).api = {
		state: {
			getCommitDraft: vi.fn(async () => ({ summary: '', description: '' })),
			setCommitDraft
		}
	};
});

afterEach(() => {
	app.activeRepo = null;
	app.changedFiles = [];
	app.commitDraft = { summary: '', description: '' };
	app.push = { ...idle };
	vi.clearAllMocks();
});

describe('CommitBox draft sharing', () => {
	it('mirrors the typed message into the store and clears once it is committed', async () => {
		const { container } = render(CommitBox);
		await sleep(20);

		const summary = container.querySelector('input[type="text"]') as HTMLInputElement;
		const description = container.querySelector('textarea') as HTMLTextAreaElement;
		type(summary, 'feat: the first thing');
		type(description, 'with a body');
		await sleep(20);

		// What the publish flow reads to name the initial commit.
		expect(app.commitDraft).toEqual({
			summary: 'feat: the first thing',
			description: 'with a body'
		});

		// The publish committed it — the box empties rather than offering the
		// message again for the next commit.
		app.commitDraftConsumed++;
		await sleep(20);

		expect(summary.value).toBe('');
		expect(description.value).toBe('');
		expect(app.commitDraft).toEqual({ summary: '', description: '' });
		expect(setCommitDraft).toHaveBeenLastCalledWith('r1', { summary: '', description: '' });
	});
});
