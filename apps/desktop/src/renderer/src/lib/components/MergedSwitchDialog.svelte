<script lang="ts">
	import { GitMerge } from 'lucide-svelte';
	import { Button } from './ui/button';
	import { Checkbox } from './ui/checkbox';
	import * as Dialog from './ui/dialog';
	import { actions, app } from '$lib/store.svelte';

	const prompt = $derived(app.mergedSwitchPrompt);
	const open = $derived(prompt !== null);

	// "Always switch back automatically" — reset each time the dialog opens so a
	// stale check from a previous prompt can't carry over.
	let always = $state(false);
	$effect(() => {
		if (open) always = false;
	});

	function confirm(): void {
		void actions.confirmSwitchToDefaultAfterMerge({ always });
	}

	function dismiss(): void {
		actions.dismissMergedSwitchPrompt();
	}
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && dismiss()}>
	<Dialog.Content class="w-[440px] max-w-[90vw]">
		<Dialog.Header class="flex flex-row items-start gap-2 space-y-0">
			<GitMerge class="mt-0.5 size-5 shrink-0 text-primary" />
			<div class="flex-1">
				<Dialog.Title class="text-sm font-semibold">PR merged</Dialog.Title>
				<Dialog.Description class="mt-1 text-xs">
					The PR for <span class="font-mono">{prompt?.branch}</span> has merged. Would you like to
					switch back to <span class="font-mono">{prompt?.defaultBranch}</span>?
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<div class="flex items-start gap-2.5 pl-7">
			<Checkbox id="merged-switch-always" bind:checked={always} class="mt-0.5" />
			<label for="merged-switch-always" class="cursor-pointer text-sm leading-snug">
				Always automatically switch back to {prompt?.defaultBranch}
			</label>
		</div>

		<Dialog.Footer>
			<Button variant="secondary" size="sm" onclick={dismiss}>Not now</Button>
			<Button variant="default" size="sm" onclick={confirm}>
				Switch to {prompt?.defaultBranch}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
