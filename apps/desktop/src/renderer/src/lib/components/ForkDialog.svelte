<script lang="ts">
	import { GitFork, Loader2 } from 'lucide-svelte';
	import { Button } from './ui/button';
	import * as Dialog from './ui/dialog';
	import ForkUseChoice from './ForkUseChoice.svelte';
	import { actions, app, effectiveGithubAccount } from '$lib/store.svelte';

	const prompt = $derived(app.forkPrompt);
	const open = $derived(prompt !== null);
	const forking = $derived(app.push.inProgress && app.push.stage === 'forking');

	// The account the fork is created under, and where it will live.
	const account = $derived(effectiveGithubAccount());
	const forkTarget = $derived(account && prompt ? `${account.login}/${prompt.repo}` : null);

	// How the fork will be used (GitHub Desktop's choice). 'parent' keeps the
	// original as upstream so PRs/sync target it; 'self' works the fork standalone.
	// Reset to the default each time the dialog opens.
	let use = $state<'parent' | 'self'>('parent');
	$effect(() => {
		if (open) use = 'parent';
	});
</script>

<Dialog.Root {open} onOpenChange={(v) => !v && actions.cancelFork()}>
	<Dialog.Content showCloseButton={false} class="w-[480px] max-w-[90vw]">
		<Dialog.Header class="flex flex-row items-start gap-2 space-y-0">
			<GitFork class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
			<div class="flex-1">
				<Dialog.Title class="text-sm font-semibold"
					>Do you want to fork this repository?</Dialog.Title
				>
				<Dialog.Description class="mt-1 space-y-2 text-xs">
					{#if prompt}
						<span class="block">
							It looks like you don't have write access to <span class="font-medium text-foreground"
								>{prompt.owner}/{prompt.repo}</span
							>. If you should, please check with a repository administrator.
						</span>
						<span class="block">
							Do you want to create a fork of this repository{#if forkTarget}&nbsp;at <span
									class="font-medium text-foreground">{forkTarget}</span
								>{/if} to continue?
						</span>
					{/if}
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<div class="flex flex-col gap-1.5">
			<span class="text-xs font-medium text-muted-foreground">How will you use this fork?</span>
			<ForkUseChoice
				bind:value={use}
				parentLabel={prompt ? `${prompt.owner}/${prompt.repo}` : null}
				disabled={forking}
				idPrefix="fork-dialog"
			/>
		</div>

		<Dialog.Footer>
			<Button variant="secondary" size="sm" onclick={() => actions.cancelFork()} disabled={forking}>
				Cancel
			</Button>
			<Button
				variant="default"
				size="sm"
				onclick={() => actions.confirmFork(use === 'parent')}
				disabled={forking}
			>
				{#if forking}
					<Loader2 class="size-3.5 animate-spin" /> Forking…
				{:else}
					Fork This Repository
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
