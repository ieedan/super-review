import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './commit-box-stream.harness.svelte';
import { app } from '@super-review/ui/store.svelte';
import type { ChangedFile, RepoInfo } from '@super-review/core/types';

// The generated message used to land in the Summary field whole, in one frame,
// even though the box has painted a streaming overlay all along. Nothing between
// the model and here streams a token at a time: the harness CLIs report partial
// messages in slabs — a measured Claude Code run answered a 434 character
// message in six deltas, the first of which already held the entire subject line
// — so painting what arrived was painting the finished subject the moment it
// showed up. The box paces the answer back out itself now.
//
// Runs in a real browser because the pacing is a requestAnimationFrame loop, and
// what the test is actually about is how much text is on screen at a given
// moment. jsdom has no frame clock to be wrong about.

const repo: RepoInfo = { id: 'r1', path: '/tmp/r1', name: 'hello', lastOpenedAt: 0 };

const files = [
	{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }
] as ChangedFile[];

const idle = { inProgress: false, stage: 'idle', intent: 'push', op: 'push', error: null } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A real first delta: the whole subject plus the start of the body, at once.
const SUBJECT = 'feat(commit-message): stream generated commit messages into the box';
const FIRST_SLAB = `${SUBJECT}\n\nThe commit message generator now`;

/**
 * What the Summary overlay has written so far.
 *
 * StreamingText merges its class over `whitespace-pre-wrap`, and the subject is
 * the only caller that overrides it — so the nowrap span is the painted subject
 * and nothing else. The waiting row shares the overlay above it until the roll
 * finishes, which is why this cannot just read the overlay's text.
 */
function summaryText(container: HTMLElement): string {
	return container.querySelector('span.whitespace-nowrap')?.textContent ?? '';
}

beforeEach(() => {
	app.activeRepo = repo;
	app.currentBranch = 'main';
	app.changedFiles = files;
	app.push = { ...idle };
	app.lastCommit = null;
	app.commitMessageGenerating = false;
	app.commitMessageReasoning = '';
	app.commitMessageAnswer = '';
	(window as unknown as { api: unknown }).api = {
		state: {
			getCommitDraft: vi.fn(async () => ({ summary: '', description: '' })),
			setCommitDraft: vi.fn(async () => {})
		}
	};
});

afterEach(() => {
	app.activeRepo = null;
	app.changedFiles = [];
	app.commitMessageGenerating = false;
	app.commitMessageAnswer = '';
	app.push = { ...idle };
	vi.clearAllMocks();
});

describe('CommitBox streaming reveal', () => {
	it('writes a slab out over time instead of painting it whole', async () => {
		const { container } = render(Harness, { mode: 'all' });
		await sleep(20);

		app.commitMessageGenerating = true;
		await sleep(20);
		expect(summaryText(container as HTMLElement)).toBe('');

		// The entire subject arrives in one update, the way it really does.
		app.commitMessageAnswer = FIRST_SLAB;

		const lengths: number[] = [];
		for (let i = 0; i < 6; i++) {
			await sleep(50);
			lengths.push(summaryText(container as HTMLElement).length);
		}

		// Something was on screen early, but not the finished subject: that is the
		// difference between writing and pasting.
		expect(lengths[0]).toBeGreaterThan(0);
		expect(lengths[0]).toBeLessThan(SUBJECT.length);
		// It grew across frames rather than snapping in one step.
		expect(new Set(lengths).size).toBeGreaterThan(2);
		expect([...lengths].sort((a, b) => a - b)).toEqual(lengths);

		// And it still finishes well inside the pause a real run leaves between its
		// last token and its result.
		await sleep(400);
		expect(summaryText(container as HTMLElement)).toBe(SUBJECT);
	});

	it('never shows text the model has not sent', async () => {
		const { container } = render(Harness, { mode: 'all' });
		await sleep(20);

		app.commitMessageGenerating = true;
		app.commitMessageAnswer = FIRST_SLAB;
		await sleep(120);

		// A retry resets the reporter, so the answer is replaced rather than
		// extended. Carrying the cursor over would splice the old prefix onto it.
		app.commitMessageAnswer = 'fix: something else entirely';
		await sleep(60);
		const shown = summaryText(container as HTMLElement);
		expect('fix: something else entirely'.startsWith(shown)).toBe(true);
	});

	it('applies at once when the user has motion turned off', async () => {
		const { container } = render(Harness, { mode: 'none' });
		await sleep(20);

		app.commitMessageGenerating = true;
		app.commitMessageAnswer = FIRST_SLAB;
		await sleep(50);

		expect(summaryText(container as HTMLElement)).toBe(SUBJECT);
	});

	it('drops the overlay when the run ends mid-reveal', async () => {
		const { container } = render(Harness, { mode: 'all' });
		await sleep(20);

		app.commitMessageGenerating = true;
		app.commitMessageAnswer = FIRST_SLAB;
		await sleep(50);
		expect(summaryText(container as HTMLElement).length).toBeLessThan(SUBJECT.length);

		// How the store ends a run: the stream is dropped in the same update. The
		// reveal does not get to finish writing, and it does not need to — the paint
		// ends on a microtask, so the real value takes the field over in the same
		// frame rather than after a visible catch-up.
		app.commitMessageGenerating = false;
		app.commitMessageAnswer = '';
		await sleep(0);
		expect(summaryText(container as HTMLElement)).toBe('');
	});
});
