<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SettingsDialog from '@super-review/ui/components/SettingsDialog.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore } from '../../lib/store-harness';
	import type { CommitMessageHarness } from '@super-review/core/types';

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
		opencode: [{ id: 'openai/gpt-5-mini', label: 'GPT-5 mini' }]
	};

	// The panel re-detects on mount, and Storybook's blanket api stub resolves
	// every call to `undefined` — which would wipe the seeded state. Wrap the
	// stub so only `commitMessage` answers from the story's fixtures.
	let detected: Record<string, boolean> = {};

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
		w.api = new Proxy(
			{},
			{ get: (_t, prop) => (prop === 'commitMessage' ? commitMessage : base[prop]) }
		);
		w.__commitMessageStub = true;
	}

	function seed(opts: {
		installed: CommitMessageHarness[];
		harness?: CommitMessageHarness | null;
	}) {
		return () => {
			installCommitMessageStub();
			detected = {
				cursor: opts.installed.includes('cursor'),
				'claude-code': opts.installed.includes('claude-code'),
				codex: opts.installed.includes('codex'),
				copilot: opts.installed.includes('copilot'),
				opencode: opts.installed.includes('opencode')
			};
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
