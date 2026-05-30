<script lang="ts">
	import { AlertTriangle, Check, ExternalLink, X } from 'lucide-svelte';
	import { Button } from './ui/button';
	import * as Dialog from './ui/dialog';
	import { actions, app, effectiveEditor } from '$lib/store.svelte';

	const editor = $derived(effectiveEditor());
	const allResolved = $derived(app.conflictFiles.length === 0);
	const open = $derived(app.push.stage === 'conflicts');
	const isPullOnly = $derived(app.push.intent === 'pull');

	async function openFile(file: string): Promise<void> {
		await actions.openInEditor(file);
	}

	async function resolve(file: string): Promise<void> {
		await actions.resolveConflict(file);
	}
</script>

<Dialog.Root {open} onOpenChange={() => {}}>
	<Dialog.Content
		showCloseButton={false}
		onInteractOutside={(e) => e.preventDefault()}
		onEscapeKeydown={(e) => e.preventDefault()}
		class="max-h-[80vh] w-[560px] max-w-[90vw] gap-0 overflow-hidden p-0"
	>
		<Dialog.Header class="flex flex-row items-start gap-2 space-y-0 border-b border-border p-4">
			<AlertTriangle class="mt-0.5 size-5 shrink-0 text-warning" />
			<div class="flex-1">
				<Dialog.Title class="text-sm font-semibold">Resolve merge conflicts</Dialog.Title>
				<Dialog.Description class="mt-1 text-xs">
					Pulling from origin produced conflicts. Open each file in your editor, resolve the
					markers, then mark it resolved.
					{#if isPullOnly}
						We'll finish the merge.
					{:else}
						We'll finish the merge and continue the push.
					{/if}
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<div class="max-h-[50vh] overflow-auto p-2">
			{#if allResolved}
				<p class="px-2 py-3 text-xs text-muted-foreground">
					All files resolved. Continue the merge to finish.
				</p>
			{/if}
			{#each app.conflictFiles as file (file)}
				<div class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50">
					<AlertTriangle class="size-3.5 shrink-0 text-warning" />
					<span class="flex-1 truncate font-mono text-xs" title={file}>{file}</span>
					<Button
						variant="ghost"
						size="sm"
						onclick={() => openFile(file)}
						disabled={!editor}
						title={editor ? `Open in ${editor}` : 'No editor configured'}
					>
						<ExternalLink class="size-3.5" />
						<span class="hidden sm:inline">Open</span>
					</Button>
					<Button variant="outline" size="sm" onclick={() => resolve(file)}>
						<Check class="size-3.5" />
						Mark resolved
					</Button>
				</div>
			{/each}
		</div>

		<Dialog.Footer
			class="flex flex-row items-center justify-between gap-2 border-t border-border p-3 sm:justify-between"
		>
			<Button variant="ghost" size="sm" onclick={() => actions.abortMerge()}>
				<X class="size-3.5" /> Abort merge
			</Button>
			<Button
				variant="default"
				size="sm"
				onclick={() => actions.continueMerge()}
				disabled={!allResolved}
			>
				{isPullOnly ? 'Continue merge' : 'Continue merge & push'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
