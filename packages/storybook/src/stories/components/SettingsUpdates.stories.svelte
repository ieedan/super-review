<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SettingsDialog from '@super-review/ui/components/SettingsDialog.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore } from '../../lib/store-harness';
	import type { UpdateStatus } from '@super-review/core/types';

	// The Settings > Updates tab, driven straight off the seeded store. The panel
	// is one row whose left side gains a status line as the update progresses, so
	// the thing to watch across these stories is that the version text and the
	// action button stay centered on the same axis and the button never moves.
	const MB = 1024 * 1024;

	// The dialog portals out of any wrapper, so no frame — it centers on the canvas.
	function seed(update: UpdateStatus, updateCheckedAt: number | null = null) {
		return () =>
			seedStore({
				settingsDialogOpen: true,
				settingsDialogTab: 'updates',
				appVersion: '0.1.27',
				update,
				updateCheckedAt
			});
	}

	const { Story } = defineMeta({
		title: 'Components/Settings Updates',
		component: SettingsDialog,
		parameters: { layout: 'fullscreen' }
	});
</script>

<!-- Launch state: nothing has been checked yet, so there's no status line and the
     version has to sit centered against the button on its own. -->
<Story name="Idle">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ state: 'idle' })}>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- A manual check came back empty: the status line appears, and the row must not
     grow or shunt the button. -->
<Story name="Up to date">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ state: 'idle' }, 1_780_000_000_000)}>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<Story name="Checking">
	{#snippet template()}
		<StoreScope frame={false} setup={seed({ state: 'checking' })}>
			<SettingsDialog />
		</StoreScope>
	{/snippet}
</Story>

<Story name="Downloading">
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

<!-- Also the dot-indicator case: the Updates tab in the left nav should carry a
     dot whenever an update is pending. -->
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
