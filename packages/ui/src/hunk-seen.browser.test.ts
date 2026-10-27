import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './test/DiffFindHarness.svelte';
import { app } from '@super-review/ui/store.svelte';
import { diffCache } from '@super-review/ui/store-cache';
import type { DiffData } from '@super-review/core/types';

// The "Mark seen per hunk" setting hangs a bar under every hunk; a file counts
// as seen once all of its hunks are. Real browser, since the bars are mounted
// into Pierre's rendered diff.

const PATH = 'src/app.ts';

function lines(n: number, edit: Record<number, string> = {}): string {
	return Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join('\n') + '\n';
}

// Two edits 45 lines apart, so they land in separate hunks.
function twoHunkFixture(): DiffData {
	return {
		file: { path: PATH, status: 'modified', additions: 2, deletions: 2, isBinary: false },
		patch: '',
		oldContents: lines(60),
		newContents: lines(60, { 5: 'changed 5', 50: 'changed 50' }),
		truncated: false
	} as DiffData;
}

const bars = (): HTMLButtonElement[] =>
	Array.from(
		document.querySelectorAll<HTMLButtonElement>(
			`section[data-file-path="${PATH}"] [data-hunk-seen-bar]`
		)
	);

afterEach(() => {
	app.markSeenPerHunk = false;
	app.seenFiles.clear();
	app.seenHunks.clear();
	diffCache.clear();
});

describe('mark seen per hunk', () => {
	it('shows no bars while the setting is off', async () => {
		render(Harness, { props: { fixtures: [twoHunkFixture()] } });
		await new Promise((r) => setTimeout(r, 500));
		expect(bars()).toHaveLength(0);
	});

	it('marks the file seen once every hunk is, and un-sees it when one is undone', async () => {
		app.markSeenPerHunk = true;
		render(Harness, { props: { fixtures: [twoHunkFixture()] } });
		await vi.waitFor(() => expect(bars()).toHaveLength(2), { timeout: 5000 });

		bars()[0].click();
		await vi.waitFor(() => expect(bars()[0].textContent).toContain('Hunk seen'));
		expect(bars()[1].textContent).toContain('Mark hunk seen');
		expect(app.seenFiles.has(PATH)).toBe(false);

		bars()[1].click();
		await vi.waitFor(() => expect(app.seenFiles.has(PATH)).toBe(true));

		// Undoing one hunk of a seen file un-sees the file but keeps the other hunk.
		bars()[0].click();
		await vi.waitFor(() => expect(app.seenFiles.has(PATH)).toBe(false));
		expect(bars()[0].textContent).toContain('Mark hunk seen');
		expect(bars()[1].textContent).toContain('Hunk seen');
	});

	it('shows every hunk as seen when the file is marked seen as a whole', async () => {
		app.markSeenPerHunk = true;
		render(Harness, { props: { fixtures: [twoHunkFixture()] } });
		await vi.waitFor(() => expect(bars()).toHaveLength(2), { timeout: 5000 });

		app.seenFiles.add(PATH);
		await vi.waitFor(() => {
			for (const bar of bars()) expect(bar.textContent).toContain('Hunk seen');
		});
	});
});
