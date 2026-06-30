<script lang="ts">
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import { Button } from './ui/button';
	import { Checkbox } from './ui/checkbox';
	import * as Dialog from './ui/dialog';
	import { actions, app } from '@super-review/ui/store.svelte';

	const prompt = $derived(app.mergedSwitchPrompt);
	const open = $derived(prompt !== null);

	// "Always do this automatically" — applies to whichever action the user picks
	// below. Reset each time the dialog opens so a stale check can't carry over.
	let always = $state(false);
	$effect(() => {
		if (open) always = false;
	});

	function switchBack(): void {
		void actions.resolveMergedSwitchPrompt({ action: 'switch', always });
	}

	function doNothing(): void {
		void actions.resolveMergedSwitchPrompt({ action: 'nothing', always });
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
					switch back to <span class="font-mono">{prompt?.targetBranch}</span>?
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<div class="flex items-start gap-2.5 pl-7">
			<Checkbox id="merged-switch-always" bind:checked={always} class="mt-0.5" />
			<label for="merged-switch-always" class="cursor-pointer text-sm leading-snug">
				Always do this automatically
			</label>
		</div>

		<Dialog.Footer>
			<Button variant="secondary" size="sm" onclick={doNothing}>Do nothing</Button>
			<Button variant="default" size="sm" onclick={switchBack}>
				Switch to {prompt?.targetBranch}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
