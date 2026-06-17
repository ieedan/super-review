<script lang="ts">
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { RadioGroup, RadioGroupItem } from './ui/radio-group';
	import { actions, app } from '$lib/store.svelte';

	type Choice = 'leave' | 'bring';

	let choice = $state<Choice>('leave');
	let busy = $state(false);

	const prompt = $derived(app.switchBranchPrompt);
	const open = $derived(prompt !== null);
	const target = $derived(prompt?.target ?? '');
	const currentBranch = $derived(app.currentBranch ?? '');

	// Reset the selection each time the dialog opens.
	$effect(() => {
		if (app.switchBranchPrompt) {
			choice = 'leave';
			busy = false;
		}
	});

	function dismiss(): void {
		if (busy) return;
		actions.dismissSwitchPrompt();
	}

	async function confirm(e?: Event): Promise<void> {
		e?.preventDefault();
		if (busy) return;
		busy = true;
		try {
			if (choice === 'bring') {
				await actions.confirmBringAndSwitch();
			} else {
				await actions.confirmLeaveAndSwitch();
			}
		} finally {
			busy = false;
		}
	}
</script>

{#snippet optionCard(id: string, value: string, title: string, description: string)}
	<label
		for={id}
		class="flex cursor-pointer flex-col rounded-lg border border-border leading-snug transition-colors has-[[data-state=checked]]:border-primary/30 has-[[data-state=checked]]:bg-primary/5 dark:has-[[data-state=checked]]:border-primary/20 dark:has-[[data-state=checked]]:bg-primary/10"
	>
		<div class="flex w-full flex-row items-center gap-3 p-3">
			<div class="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
				<span class="truncate text-sm leading-snug font-medium">{title}</span>
				<span class="text-xs leading-snug text-muted-foreground">
					{description}
				</span>
			</div>
			<RadioGroupItem {id} {value} />
		</div>
	</label>
{/snippet}

<Dialog.Root {open} onOpenChange={(v) => !v && dismiss()}>
	<Dialog.Content class="overflow-hidden sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				<GitBranch class="size-4" />
				Switch Branch
			</Dialog.Title>
			<Dialog.Description class="text-xs">
				You have changes on this branch. What would you like to do with them?
			</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-4" onsubmit={confirm}>
			<RadioGroup bind:value={choice} disabled={busy} class="gap-2">
				{@render optionCard(
					'switch-branch-leave',
					'leave',
					`Leave my changes on ${currentBranch}`,
					'Your in-progress work will be stashed on this branch for you to return to later'
				)}
				{@render optionCard(
					'switch-branch-bring',
					'bring',
					`Bring my changes to ${target}`,
					'Your in-progress work will follow you to the new branch'
				)}
			</RadioGroup>

			<Dialog.Footer>
				<Button type="button" variant="ghost" size="sm" disabled={busy} onclick={dismiss}>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={busy}>
					{#if busy}
						<Loader2 class="size-3.5 animate-spin" /> Switching…
					{:else}
						Switch Branch
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
