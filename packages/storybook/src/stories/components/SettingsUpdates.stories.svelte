<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SettingsDialog from '@super-review/ui/components/SettingsDialog.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore } from '../../lib/store-harness';
	import type { UpdateStatus } from '@super-review/core/types';

	// The Settings > Updates tab: Apple-style stacked inset groups for the status
	// flow, installed version, and automatic-updates toggle. Stories cover each
	// status-row state so the icons, copy, and Restart action stay consistent.
	const MB = 1024 * 1024;

	// The dialog portals out of any wrapper, so no frame — it centers on the canvas.
	function seed(
		update: UpdateStatus,
		opts: { updateCheckedAt?: number | null; updateCheckRequestedAt?: number | null } = {}
	) {
		return () =>
			seedStore({
				settingsDialogOpen: true,
				settingsDialogTab: 'updates',
				appVersion: '0.1.27',
				update,
				// Stamp both timestamps so the tab's auto-check effect doesn't fire
				// and overwrite the seeded status while the story is being viewed.
				updateCheckedAt: opts.updateCheckedAt ?? null,
				updateCheckRequestedAt: opts.updateCheckRequestedAt ?? Date.now()
			});
	}

	const { Story } = defineMeta({
		title: 'Components/Settings Updates',
		component: SettingsDialog,
		parameters: { layout: 'fullscreen' }
	});
</script>

<!-- Fresh session before a check has finished: spinner + "Checking for updates..."
     (the tab also auto-checks on open when the throttle allows). -->
<Story name="Checking">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ state: 'checking' })}>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- A check came back empty: cloud-check + "Up to date. Checked at …". -->
<Story name="Up to date">
	{#snippet template()}
		<StoreScope
			frame={false}
			setup={seed(
				{ state: 'idle' },
				{ updateCheckedAt: Date.now() - 60_000, updateCheckRequestedAt: Date.now() }
			)}
		>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<Story name="Installing">
	{#snippet template()}
		<StoreScope
			frame={false}
			setup={seed({
				state: 'downloading',
				version: '0.1.28',
				percent: 47,
				transferred: 39 * MB,
				total: 84 * MB,
				bytesPerSecond: 6 * MB
			})}
		>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- Dot on the Updates nav item + Restart in the status row. -->
<Story name="Ready to install">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ state: 'downloaded', version: '0.1.28' })}>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<Story name="Check failed">
	{#snippet template()}
		<StoreScope
			frame={false}
			setup={seed({ state: 'error', message: 'net::ERR_CONNECTION_REFUSED' })}
		>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>
