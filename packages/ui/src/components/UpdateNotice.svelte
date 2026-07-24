<script lang="ts">
	// The app-update notice, across the whole update lifecycle. Takes the raw
	// UpdateStatus so the state -> presentation mapping lives here instead of in
	// every call site:
	//   downloading -> a spinner, the version, and a percent
	//   downloaded  -> "Update ready" with a Restart action
	//   everything else (idle / checking / available / error) -> nothing, since a
	//     silent background check shouldn't nag and a failed one just retries.
	// Presentational: callbacks in, no store, so it can be exercised in isolation
	// (see UpdateNotice.stories).
	import Loader from '@lucide/svelte/icons/loader';
	import OfflineIcon from '@iconify/svelte/dist/OfflineIcon.svelte';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import type { UpdateStatus } from '@super-review/core/types';
	import { SUPER_REVIEW_ICON } from '@super-review/ui/file-icons';
	import { Button } from './ui/button';
	import { Spinner } from './ui/spinner';
	import NoticeCard from './NoticeCard.svelte';

	let {
		status,
		onRestart,
		onDismiss
	}: {
		/** Live update state, straight from the store (app.update). */
		status: UpdateStatus;
		/** Install the downloaded update and relaunch. */
		onRestart: () => void;
		/** When set, the ready card renders a dismiss button. The update still
		 * installs on the next quit. Downloading is never dismissible. */
		onDismiss?: () => void;
	} = $props();

	// Clamp so a bad percent can't overflow the track or run negative.
	const width = $derived(
		status.state === 'downloading' ? Math.min(100, Math.max(0, status.percent)) : 0
	);
</script>

{#if status.state === 'downloading'}
	<div
		class="relative flex flex-col gap-1.5 overflow-hidden rounded-md border border-border bg-card/90 px-2 py-1.5 shadow-sm backdrop-blur-md"
	>
		<div class="flex items-center gap-2">
			<Spinner class="size-4 shrink-0 text-muted-foreground">
				{#snippet child({ props })}
					<Loader {...props} />
				{/snippet}
			</Spinner>
			<span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
				Downloading update{status.version ? ` v${status.version}` : ''}
			</span>
			<span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">{width}%</span>
		</div>
	</div>
{:else if status.state === 'downloaded'}
	<NoticeCard
		{onDismiss}
		dismissTitle="Dismiss (installs on next quit)"
		tooltip="A new version has been downloaded. Restart to finish installing, or it'll apply next time you quit."
	>
		{#snippet logo()}
			<OfflineIcon icon={SUPER_REVIEW_ICON} class="size-5 shrink-0" />
		{/snippet}
		Update {status.version ? ` v${status.version}` : ''} ready
		{#snippet action()}
			<Button type="button" size="xs" variant="outline" class="h-6 text-[11px]" onclick={onRestart}>
				<RotateCw class="size-3" />
				Restart
			</Button>
		{/snippet}
	</NoticeCard>
{/if}
