import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import MarkdownComposer from '@super-review/ui/components/MarkdownComposer.svelte';
import { app } from '@super-review/ui/store.svelte';
import type { RepoInfo } from '@super-review/core/types';

// Runs in a real browser because it drives Carta's <textarea> with genuine
// InputEvents and relies on `carta.bindToCaret` teleporting the popup into
// <body> — neither works in jsdom. Verifies the whole typeahead wiring: the
// GithubSuggest plugin mounts, detects the trigger, fetches via window.api, and
// inserts the chosen reference.

const repo: RepoInfo = {
	id: 'r1',
	path: '/tmp/r1',
	name: 'hello',
	githubOwner: 'octocat',
	githubRepo: 'hello',
	lastOpenedAt: 0
};

const listMentionableUsers = vi.fn(async () => [
	{ login: 'octocat', avatarUrl: 'https://example.com/a.png' },
	{ login: 'octodog', avatarUrl: 'https://example.com/b.png' }
]);
const listIssueReferences = vi.fn(async () => [
	{ number: 2748, title: 'Fix the widget', state: 'open', isPullRequest: true, draft: false }
]);

// carta-md highlights the Write-tab source asynchronously; if the composer
// unmounts (test-end auto-cleanup) before that resolves, carta writes
// `innerHTML` on its now-removed overlay and rejects — its own teardown race,
// harmless but enough to fail the run. Letting the pending highlight settle
// while still mounted avoids it entirely.
const settle = () => new Promise((r) => setTimeout(r, 250));

beforeEach(() => {
	app.activeRepo = repo;
	// Minimal window.api the fetchers reach through.
	(window as unknown as { api: unknown }).api = {
		github: { listMentionableUsers, listIssueReferences }
	};
});

afterEach(() => {
	app.activeRepo = null;
	document.querySelectorAll('.carta-gh-suggest').forEach((n) => n.remove());
	vi.clearAllMocks();
});

async function getTextarea(): Promise<HTMLTextAreaElement> {
	// Carta mounts its <textarea id="md"> during its own mount, a frame after ours.
	return await vi.waitFor(() => {
		const ta = document.querySelector('.markdown-composer textarea') as HTMLTextAreaElement | null;
		if (!ta) throw new Error('textarea not mounted yet');
		return ta;
	});
}

describe('@mention typeahead', () => {
	it('opens on @, filters, and inserts the selected login', async () => {
		render(MarkdownComposer, { props: { value: '' } });
		const ta = await getTextarea();
		ta.focus();
		await userEvent.type(ta, '@oct');

		const popup = await vi.waitFor(() => {
			const el = document.querySelector('.carta-gh-suggest');
			if (!el) throw new Error('popup not shown');
			return el;
		});
		expect(popup.textContent).toContain('octocat');
		expect(listMentionableUsers).toHaveBeenCalledWith('r1');

		// Enter selects the highlighted (first) row and inserts `@octocat `.
		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() => expect(ta.value).toBe('@octocat '));
		await vi.waitFor(() => expect(document.querySelector('.carta-gh-suggest')).toBeNull());
		await settle();
	});
});

describe('#reference typeahead', () => {
	it('opens on #, shows the issue/PR, and inserts its number', async () => {
		render(MarkdownComposer, { props: { value: '' } });
		const ta = await getTextarea();
		ta.focus();
		await userEvent.type(ta, '#27');

		const popup = await vi.waitFor(() => {
			const el = document.querySelector('.carta-gh-suggest');
			if (!el) throw new Error('popup not shown');
			return el;
		});
		expect(popup.textContent).toContain('2748');

		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() => expect(ta.value).toBe('#2748 '));
		await settle();
	});
});
