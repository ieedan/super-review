<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { Button } from './ui/button';
	import * as Dialog from './ui/dialog';
	import { actions, app } from '$lib/store.svelte';

	const prompt = $derived(app.stashPrompt);
	const open = $derived(prompt !== null);

	function confirm(): void {
		void actions.confirmStashAndPull();
	}

	function dismiss(): void {
		actions.dismissStashPrompt();
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && dismiss()}>
	<Dialog.Content class="w-[480px] max-w-[90vw] gap-0 overflow-hidden p-0">
		<Dialog.Header class="flex flex-row items-start gap-2 space-y-0 border-b border-border p-4">
			<AlertTriangle class="mt-0.5 size-5 shrink-0 text-warning" />
			<div class="flex-1">
				<Dialog.Title class="text-sm font-semibold">
					Unable to pull when changes are present on your branch
				</Dialog.Title>
				<Dialog.Description class="mt-1 text-xs">
					The following files would be overwritten:
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<div class="max-h-[40vh] overflow-auto p-2">
			{#each prompt?.files ?? [] as file (file)}
				<div class="flex items-center gap-2 rounded px-2 py-1.5">
					<span class="flex-1 truncate font-mono text-xs" title={file}>{file}</span>
				</div>
			{/each}
		</div>

		<p class="px-4 pb-3 text-xs text-muted-foreground">
			You can stash your changes now and recover them afterwards.
		</p>

		<Dialog.Footer class="mx-0 mb-0 border-t border-border p-3">
			<Button variant="secondary" size="sm" onclick={dismiss}>Close</Button>
			<Button variant="default" size="sm" onclick={confirm}>Stash Changes and Continue</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
