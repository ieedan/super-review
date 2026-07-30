import { describe, it, expect, beforeEach } from 'vitest';
import { actions, app } from '@super-review/ui/store.svelte';
import type {
	CommitMessageHarness,
	CommitMessageHarnessStatus,
	HarnessAuthState,
	UserPrefs
} from '@super-review/core/types';

// The signed-out-harness recovery flow, driven through the store rather than the
// UI. "I've signed in" has to re-probe for real and then decide whether to close
// itself, and getting that wrong is invisible in a screenshot: a dialog that
// closes on a failed recheck looks exactly like one that closed on success.
//
// A browser test, not a unit one, only because importing the store pulls in
// markdown.ts -> DOMPurify, which needs a real DOM. Nothing here touches the UI.

const HARNESSES: CommitMessageHarness[] = ['cursor', 'claude-code', 'codex', 'copilot', 'opencode'];

function status(
	seeds: Partial<Record<CommitMessageHarness, HarnessAuthState | false>>
): CommitMessageHarnessStatus {
	const out = {} as CommitMessageHarnessStatus;
	for (const harness of HARNESSES) {
		const seed = seeds[harness];
		out[harness] =
			seed === undefined || seed === false
				? { installed: false, auth: 'unknown' }
				: { installed: true, auth: seed };
	}
	return out;
}

// Stand in for the preload bridge. `detect` answers with whatever the test
// queues up, so a recheck can be made to succeed or fail.
function setApi(commitMessage: Record<string, unknown>): void {
	(window as unknown as { api: unknown }).api = { commitMessage };
}

// Only `commitMessageHarness` matters here; UserPrefs has 30-odd other required
// fields that none of these assertions touch.
function prefs(partial: Partial<UserPrefs>): UserPrefs {
	return partial as UserPrefs;
}

function stubApi(next: () => CommitMessageHarnessStatus): { detectCalls: boolean[] } {
	const detectCalls: boolean[] = [];
	setApi({
		detect: async (force?: boolean) => {
			detectCalls.push(force === true);
			return next();
		},
		listModels: async () => []
	});
	return { detectCalls };
}

beforeEach(() => {
	app.harnessSignIn = { harness: null, open: false, checking: false, recheckFailed: false };
	app.commitMessageHarnesses = null;
	app.prefs = prefs({});
	app.errors = [];
	app.settingsDialogOpen = false;
	app.settingsDialogTab = null;
});

describe('openAgentSettingsFromSignIn', () => {
	// The dialog sits on a higher layer than Settings, so it has to get out of
	// the way — otherwise the settings it just opened render underneath it.
	it('closes the dialog and opens Agents settings', () => {
		app.commitMessageHarnesses = status({ 'claude-code': 'missing', cursor: 'ok' });
		actions.openHarnessSignIn('claude-code');

		actions.openAgentSettingsFromSignIn();

		expect(app.harnessSignIn.open).toBe(false);
		expect(app.settingsDialogOpen).toBe(true);
		expect(app.settingsDialogTab).toBe('agents');
	});
});

describe('recheckHarnessSignIn', () => {
	it('closes the dialog when the CLI now has a session', async () => {
		const { detectCalls } = stubApi(() => status({ 'claude-code': 'ok' }));
		app.commitMessageHarnesses = status({ 'claude-code': 'missing' });
		actions.openHarnessSignIn('claude-code');
		expect(app.harnessSignIn.open).toBe(true);

		await actions.recheckHarnessSignIn();

		expect(app.harnessSignIn.open).toBe(false);
		expect(app.harnessSignIn.recheckFailed).toBe(false);
		expect(app.harnessSignIn.checking).toBe(false);
		// Must bypass the main process's one-minute auth cache, or a sign-in that
		// just happened can't possibly be seen.
		expect(detectCalls).toEqual([true]);
	});

	// The regression that a screenshot cannot catch: closing here would tell the
	// user they're done when they aren't.
	it('stays open and says so when the CLI is still signed out', async () => {
		stubApi(() => status({ 'claude-code': 'missing' }));
		app.commitMessageHarnesses = status({ 'claude-code': 'missing' });
		actions.openHarnessSignIn('claude-code');

		await actions.recheckHarnessSignIn();

		expect(app.harnessSignIn.open).toBe(true);
		expect(app.harnessSignIn.recheckFailed).toBe(true);
		expect(app.harnessSignIn.checking).toBe(false);
	});

	it('reports still-signed-out rather than throwing when the probe fails', async () => {
		setApi({
			detect: async () => {
				throw new Error('IPC exploded');
			},
			listModels: async () => []
		});
		app.commitMessageHarnesses = status({ 'claude-code': 'missing' });
		actions.openHarnessSignIn('claude-code');

		await actions.recheckHarnessSignIn();

		expect(app.harnessSignIn.open).toBe(true);
		expect(app.harnessSignIn.recheckFailed).toBe(true);
	});

	it('ignores a second click while a recheck is in flight', async () => {
		// Captured out of the executor via an explicit holder: assigning straight to
		// a `let` narrows it to `never` for the later call.
		const holder: { release?: () => void } = {};
		const gate = new Promise<void>((r) => {
			holder.release = r;
		});
		const detectCalls: number[] = [];
		setApi({
			detect: async () => {
				detectCalls.push(1);
				await gate;
				return status({ 'claude-code': 'ok' });
			},
			listModels: async () => []
		});
		app.commitMessageHarnesses = status({ 'claude-code': 'missing' });
		actions.openHarnessSignIn('claude-code');

		const first = actions.recheckHarnessSignIn();
		expect(app.harnessSignIn.checking).toBe(true);
		await actions.recheckHarnessSignIn(); // should no-op
		holder.release?.();
		await first;

		expect(detectCalls).toHaveLength(1);
		expect(app.harnessSignIn.open).toBe(false);
	});

	it('does nothing when no harness is set', async () => {
		stubApi(() => status({ 'claude-code': 'ok' }));
		await actions.recheckHarnessSignIn();
		expect(app.harnessSignIn.open).toBe(false);
		expect(app.harnessSignIn.harness).toBeNull();
	});

	// The bug this caught: a detect() that resolves with nothing used to read as
	// "not 'missing'", so the dialog closed and told the user they were signed in
	// when we had learned nothing at all.
	it('stays open when the probe answers with no data', async () => {
		setApi({
			detect: async () => undefined,
			listModels: async () => []
		});
		app.commitMessageHarnesses = status({ 'claude-code': 'missing' });
		actions.openHarnessSignIn('claude-code');

		await actions.recheckHarnessSignIn();

		expect(app.harnessSignIn.open).toBe(true);
		expect(app.harnessSignIn.recheckFailed).toBe(true);
		// The empty answer must not have destroyed what we already knew.
		expect(app.commitMessageHarnesses?.['claude-code'].auth).toBe('missing');
	});

	// Copilot has no way to report auth, so it probes 'unknown'. Keeping the
	// dialog open would trap the user in something they can never satisfy.
	it('closes when the CLI reports an unverifiable session', async () => {
		stubApi(() => status({ copilot: 'unknown' }));
		app.commitMessageHarnesses = status({ copilot: 'missing' });
		actions.openHarnessSignIn('copilot');

		await actions.recheckHarnessSignIn();

		expect(app.harnessSignIn.open).toBe(false);
		expect(app.harnessSignIn.recheckFailed).toBe(false);
	});
});

describe('refreshCommitMessageHarnesses', () => {
	it('keeps the last known status when detect resolves with nothing', async () => {
		setApi({ detect: async () => undefined, listModels: async () => [] });
		app.commitMessageHarnesses = status({ 'claude-code': 'ok' });

		await actions.refreshCommitMessageHarnesses();

		expect(app.commitMessageHarnesses?.['claude-code'].auth).toBe('ok');
	});

	it('takes a real answer', async () => {
		setApi({
			detect: async () => status({ 'claude-code': 'missing' }),
			listModels: async () => []
		});
		app.commitMessageHarnesses = status({ 'claude-code': 'ok' });

		await actions.refreshCommitMessageHarnesses();

		expect(app.commitMessageHarnesses?.['claude-code'].auth).toBe('missing');
	});
});
