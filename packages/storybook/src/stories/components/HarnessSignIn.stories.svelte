<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import HarnessSignInDialog from '@super-review/ui/components/HarnessSignInDialog.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { harnessStatus, seedStore } from '../../lib/store-harness';
	import type { CommitMessageHarness, TerminalKind } from '@super-review/core/types';

	// "Your agent CLI isn't signed in", shown when a run reaches a harness with no
	// session. Deliberately a dialog and not an error toast: nothing broke, a CLI
	// just needs signing in — so no red card and no "Report" button.
	const TERMINALS: Record<TerminalKind, boolean> = {
		terminal: true,
		iterm: false,
		warp: false,
		ghostty: true,
		cmd: false,
		powershell: false
	};

	// These stories are for the *look* of each state. "I've signed in" re-probes
	// through window.api.commitMessage.detect(), which Storybook's blanket api
	// stub answers for — so clicking it in here doesn't reproduce the real
	// outcome. The behaviour (close on success, stay open and warn on failure,
	// don't close on an empty answer) is covered by
	// packages/ui/src/harness-sign-in.browser.test.ts, which drives the store
	// actions directly. Each state below is seeded rather than clicked into.
	function seed(opts: {
		harness: CommitMessageHarness;
		recheckFailed?: boolean;
		checking?: boolean;
		terminal?: boolean;
	}) {
		return () => {
			seedStore({
				activeRepo: { id: 'repo-1', name: 'super-review', path: '/tmp/super-review' },
				currentBranch: 'feat/harness-auth-recovery',
				commitMessageHarnesses: harnessStatus({ [opts.harness]: 'signed-out', cursor: 'ok' }),
				prefs: { commitMessageHarness: opts.harness },
				terminals: opts.terminal === false ? ({} as Record<TerminalKind, boolean>) : TERMINALS,
				harnessSignIn: {
					harness: opts.harness,
					open: true,
					checking: opts.checking ?? false,
					recheckFailed: opts.recheckFailed ?? false
				}
			});
		};
	}

	const { Story } = defineMeta({
		title: 'Components/Harness Sign In',
		parameters: { layout: 'fullscreen' }
	});
</script>

<!-- The common case: a two-step login. "Agent settings" is the way out that
     isn't signing back in — another installed agent will do the job, and that
     page already lists every one with its auth state and model. -->
<Story name="Two-step login">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ harness: 'claude-code' })}>
			<HarnessSignInDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- Single-step login: prose, not a lone numbered "1.". -->
<Story name="Single-step login">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ harness: 'opencode' })}>
			<HarnessSignInDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- "I've signed in" came back still signed out. The dialog stays open and says
     so — closing silently would look like the button did nothing. -->
<Story name="Recheck failed">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ harness: 'claude-code', recheckFailed: true })}>
			<HarnessSignInDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- Mid-recheck: the probe spawns a CLI, so it is not instant. -->
<Story name="Checking">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ harness: 'claude-code', checking: true })}>
			<HarnessSignInDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- No terminal detected: nothing offers to open one that isn't there. -->
<Story name="No terminal detected">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ harness: 'cursor', terminal: false })}>
			<HarnessSignInDialog />
		</StoreScope>
	{/snippet}
</Story>
