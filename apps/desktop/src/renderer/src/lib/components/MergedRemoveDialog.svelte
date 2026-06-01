<script lang="ts">
	import { Trash2 } from 'lucide-svelte';
	import { Button } from './ui/button';
	import { Checkbox } from './ui/checkbox';
	import * as Dialog from './ui/dialog';
	import { actions, app } from '$lib/store.svelte';

	const prompt = $derived(app.mergedRemovePrompt);
	const open = $derived(prompt !== null);

	// "Always remove merged branches" — reset each time the dialog opens.
	let always = $state(false);
	$effect(() => {
		if (open) always = false;
	});

	function confirm(): void {
		void actions.confirmRemoveMergedBranch({ always });
	}

	function dismiss(): void {
		actions.dismissMergedRemovePrompt();
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && dismiss()}>
	<Dialog.Content class="w-[440px] max-w-[90vw]">
		<Dialog.Header class="flex flex-row items-start gap-2 space-y-0">
			<Trash2 class="mt-0.5 size-5 shrink-0 text-warning" />
			<div class="flex-1">
				<Dialog.Title class="text-sm font-semibold">Remove this branch locally?</Dialog.Title>
				<Dialog.Description class="mt-1 text-xs">
					<span class="font-mono">{prompt?.branch}</span> has merged. Delete the local branch? This only
					removes it from your machine — the remote is untouched.
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<div class="flex items-start gap-2.5 pl-7">
			<Checkbox id="merged-remove-always" bind:checked={always} class="mt-0.5" />
			<label for="merged-remove-always" class="cursor-pointer text-sm leading-snug">
				Always remove merged branches locally
			</label>
		</div>

		<Dialog.Footer>
			<Button variant="secondary" size="sm" onclick={dismiss}>Keep branch</Button>
			<Button variant="destructive" size="sm" onclick={confirm}>Remove branch</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
