<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Check from '@lucide/svelte/icons/check';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import X from '@lucide/svelte/icons/x';
	import { Button } from './ui/button';
	import * as Dialog from './ui/dialog';
	import { actions, app, effectiveEditor, EDITOR_LABELS } from '@super-review/ui/store.svelte';

	const editor = $derived(effectiveEditor());
	const open = $derived(app.push.stage === 'conflicts');
	// Only a `push` flow pushes after the merge is finished. A pull-only flow and a
	// stash restore (which pops into the working tree, never commits or pushes)
	// both just finish the merge — so they drop the "& push" wording.
	const pushesAfterMerge = $derived(app.push.intent === 'push');

	// A file is resolved once its conflict markers are gone — recheckConflicts
	// (polled below) stages it and drops it from the unresolved set. The dialog
	// keeps showing every file, flipping its icon from alert to check.
	const unresolved = $derived(new Set(app.conflictUnresolved));
	const allResolved = $derived(app.conflictFiles.length > 0 && unresolved.size === 0);

	const editorLabel = $derived(editor ? EDITOR_LABELS[editor] : null);

	// While the dialog is open, poll for resolution so editing a file to remove
	// its markers (in the editor) flips it to a check without any extra click.
	$effect(() => {
		if (!open) return;
		void actions.recheckConflicts();
		const id = setInterval(() => void actions.recheckConflicts(), 1000);
		return () => clearInterval(id);
	});

	async function openFile(file: string): Promise<void> {
		await actions.openInEditor(file);
	}
</script>

<Dialog.Root {open} onOpenChange={() => {}}>
	<Dialog.Content
		showCloseButton={false}
		onInteractOutside={(e) => e.preventDefault()}
		onEscapeKeydown={(e) => e.preventDefault()}
		onFocusOutside={(e) => e.preventDefault()}
		class="max-h-[80vh] w-[560px] max-w-[90vw] gap-0 overflow-hidden p-0"
	>
		<Dialog.Header class="flex flex-row items-start gap-2 space-y-0 border-b border-border p-4">
			<AlertTriangle class="mt-0.5 size-5 shrink-0 text-warning" />
			<div class="flex-1">
				<Dialog.Title class="text-sm font-semibold">Resolve merge conflicts</Dialog.Title>
				<Dialog.Description class="mt-1 text-xs">
					Merging produced conflicts. Open each file{editorLabel ? ` in ${editorLabel}` : ''},
					resolve the markers, and save. Each file is checked off automatically once its markers are
					gone.
					{#if pushesAfterMerge}
						Then we'll finish the merge and continue the push.
					{:else}
						Then we'll finish the merge.
					{/if}
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<div class="max-h-[50vh] overflow-auto p-2">
			{#each app.conflictFiles as file (file)}
				{@const resolved = !unresolved.has(file)}
				<div class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50">
					{#if resolved}
						<Check class="size-3.5 shrink-0 text-success" aria-label="Resolved" />
					{:else}
						<AlertTriangle class="size-3.5 shrink-0 text-warning" aria-label="Unresolved" />
					{/if}
					<span class="flex-1 truncate font-mono text-xs" title={file}>{file}</span>
					<Button
						variant="outline"
						size="sm"
						onclick={() => openFile(file)}
						disabled={!editor}
						title={editor ? `Open in ${editorLabel}` : 'No editor configured'}
					>
						<SquarePen class="size-3.5" />
						{editorLabel ? `Resolve in ${editorLabel}` : 'Resolve'}
					</Button>
				</div>
			{/each}
		</div>

		<Dialog.Footer
			class="mx-0 mb-0 flex-row items-center justify-between border-t border-border p-3 sm:justify-between"
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
				{pushesAfterMerge ? 'Continue merge & push' : 'Continue merge'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
