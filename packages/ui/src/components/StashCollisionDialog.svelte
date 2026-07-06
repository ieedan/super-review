<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { Button } from './ui/button';
	import * as Dialog from './ui/dialog';
	import { actions, app } from '@super-review/ui/store.svelte';

	const collision = $derived(app.stashCollision);
	const open = $derived(collision !== null);
	const count = $derived(collision?.files.length ?? 0);

	function restoreRest(): void {
		void actions.resolveStashCollisionKeepingLocal();
	}

	function dismiss(): void {
		actions.dismissStashCollision();
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && dismiss()}>
	<Dialog.Content class="w-[480px] max-w-[90vw] gap-0 overflow-hidden p-0">
		<Dialog.Header class="flex flex-row items-start gap-2 space-y-0 border-b border-border p-4">
			<AlertTriangle class="mt-0.5 size-5 shrink-0 text-warning" />
			<div class="flex-1">
				<Dialog.Title class="text-sm font-semibold">Some stashed files already exist</Dialog.Title>
				<Dialog.Description class="mt-1 text-xs">
					{count}
					{count === 1 ? 'file' : 'files'} saved in this stash already {count === 1
						? 'exists'
						: 'exist'} in your working tree, so it can't be restored as-is:
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<div class="max-h-[40vh] overflow-auto p-2">
			{#each collision?.files ?? [] as file (file)}
				<div class="flex items-center gap-2 rounded px-2 py-1.5">
					<span class="flex-1 truncate font-mono text-xs" title={file}>{file}</span>
				</div>
			{/each}
		</div>

		<p class="px-4 pb-3 text-xs text-muted-foreground">
			Restore the rest keeps your current versions of these files and restores everything else the
			stash holds. Your stashed changes stay safe until you choose.
		</p>

		<Dialog.Footer class="mx-0 mb-0 border-t border-border p-3">
			<Button variant="secondary" size="sm" onclick={dismiss}>Cancel</Button>
			<Button variant="default" size="sm" onclick={restoreRest}>Restore the rest</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
