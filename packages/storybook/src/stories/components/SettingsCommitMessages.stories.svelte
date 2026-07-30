<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SettingsDialog from '@super-review/ui/components/SettingsDialog.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { harnessStatus, seedStore } from '../../lib/store-harness';
	import { app } from '@super-review/ui/store.svelte';
	import { OPENCODE_MODELS } from '../../lib/commit-message-flow';
	import type { CommitMessageHarness, CommitMessageHarnessStatus } from '@super-review/core/types';

	// Settings > Agents > Commit messages: one row per supported harness CLI, each
	// with its own default-model picker and a "Set as default" action (the current
	// default shows the badge instead). Uninstalled CLIs dim out.
	const MODELS = {
		'claude-code': [
			{ id: 'claude-opus-5', label: 'Opus 5' },
			{ id: 'claude-sonnet-5', label: 'Sonnet 5' },
			{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
		],
		cursor: [
			{ id: 'composer-1', label: 'Composer 1' },
			{ id: 'gpt-5', label: 'GPT-5' }
		],
		// OpenCode's own picker groups this by provider, so keep the real slug shape.
		opencode: OPENCODE_MODELS
	};

	// The panel re-detects on mount, and Storybook's blanket api stub resolves
	// every call to `undefined` — which would wipe the seeded state. Wrap the
	// stub so `commitMessage` answers from the story's fixtures and `setPrefs`
	// merges instead of resolving undefined (picking a model has to stick).
	let detected: CommitMessageHarnessStatus = harnessStatus([]);

	function installCommitMessageStub(): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const w = window as any;
		if (w.__commitMessageStub) return;
		const base = w.api;
		const commitMessage = {
			detect: async () => detected,
			listModels: async (harness: CommitMessageHarness) =>
				MODELS[harness as keyof typeof MODELS] ?? []
		};
		const state = new Proxy(
			{},
			{
				get: (_t, prop) =>
					prop === 'setPrefs'
						? async (patch: Record<string, unknown>) => {
								app.prefs = { ...(app.prefs ?? {}), ...patch };
								return app.prefs;
							}
						: base?.state?.[prop]
			}
		);
		w.api = new Proxy(
			{},
			{
				get: (_t, prop) => {
					if (prop === 'commitMessage') return commitMessage;
					if (prop === 'state') return state;
					return base[prop];
				}
			}
		);
		w.__commitMessageStub = true;
	}

	function seed(opts: {
		// A list of signed-in CLIs, or a per-harness record when a story needs to
		// show one installed but signed out.
		installed: Parameters<typeof harnessStatus>[0];
		harness?: CommitMessageHarness | null;
	}) {
		return () => {
			installCommitMessageStub();
			detected = harnessStatus(opts.installed);
			seedStore({
				settingsDialogOpen: true,
				settingsDialogTab: 'agents',
				commitMessageHarnesses: detected,
				commitMessageModels: MODELS,
				prefs: {
					commitMessageHarness: opts.harness ?? null,
					commitMessageModels: { 'claude-code': 'claude-sonnet-5' }
				}
			});
		};
	}

	const { Story } = defineMeta({
		title: 'Components/Settings Commit Messages',
		component: SettingsDialog,
		parameters: { layout: 'fullscreen' }
	});
</script>

<!-- Two CLIs installed, Claude Code pinned as the default. -->
<Story name="Default pinned">
	{#snippet template()}
		<StoreScope
			frame={false}
			setup={seed({ installed: ['cursor', 'claude-code', 'opencode'], harness: 'claude-code' })}
		>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- No pref saved: the first installed CLI in priority order is the effective
     default, so it carries the badge without the user having chosen it. -->
<Story name="Auto-selected default">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ installed: ['cursor', 'opencode'], harness: null })}>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- Nothing installed: every row dims and only the hint remains actionable. -->
<Story name="None installed">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ installed: [], harness: null })}>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- Installed but signed out: the row says so and offers the login command,
     instead of looking identical to a working CLI until a generation fails.
     Claude Code stays the saved default here — a signed-out pref is still the
     user's pick, and the row is where they see why it isn't working. -->
<Story name="Signed out">
	{#snippet template()}
		<StoreScope
			frame={false}
			setup={seed({
				installed: { 'claude-code': 'signed-out', cursor: 'ok', opencode: 'unknown' },
				harness: 'claude-code'
			})}
		>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>
