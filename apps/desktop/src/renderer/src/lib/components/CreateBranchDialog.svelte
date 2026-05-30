<script lang="ts">
	import { Check, GitBranch, Loader2 } from 'lucide-svelte';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { Input } from './ui/input';
	import { RadioGroup, RadioGroupItem } from './ui/radio-group';
	import { actions, app } from '$lib/store.svelte';

	type BaseChoice = 'default' | 'current';
	type BringChoice = 'bring' | 'leave';
	type Step = 'base' | 'bring';

	let name = $state('');
	let baseChoice = $state<BaseChoice>('default');
	let bringChoice = $state<BringChoice>('bring');
	let dirty = $state(false);
	let step = $state<Step>('base');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const defaultBranch = $derived(app.activeRepo?.defaultBranch ?? null);
	const currentBranch = $derived(app.currentBranch ?? null);
	const showCurrentOption = $derived(!!currentBranch && currentBranch !== defaultBranch);

	const baseRef = $derived(
		baseChoice === 'default' && defaultBranch
			? defaultBranch
			: (currentBranch ?? defaultBranch ?? undefined)
	);

	// The branch is created in step one. The "what about your changes?" step is
	// only relevant when the working tree is dirty — otherwise there's nothing
	// to decide and we switch onto the new branch immediately.
	const needsBringStep = $derived(dirty && !!currentBranch);
	const canCreate = $derived(!!name.trim() && !!baseRef && !busy);

	$effect(() => {
		if (!app.createBranchDialogOpen) {
			name = '';
			baseChoice = 'default';
			bringChoice = 'bring';
			dirty = false;
			step = 'base';
			busy = false;
			error = null;
			return;
		}
		if (!defaultBranch && currentBranch) baseChoice = 'current';
		if (!app.activeRepo) return;
		const repoId = app.activeRepo.id;
		void window.api.git.isDirty(repoId).then((d) => {
			if (app.activeRepo?.id === repoId && app.createBranchDialogOpen) {
				dirty = d;
			}
		});
	});

	// Step one. Create the branch right away. When the working tree is dirty we
	// create it without switching (so the user keeps deciding from a stable
	// spot) and move to step two; otherwise we switch onto it and we're done.
	async function create(e?: Event): Promise<void> {
		e?.preventDefault();
		if (!canCreate) return;
		busy = true;
		error = null;
		try {
			const ok = await actions.createBranch(name.trim(), {
				base: baseRef,
				checkout: !needsBringStep
			});
			if (!ok) return;
			if (needsBringStep) {
				step = 'bring';
			} else {
				actions.closeCreateBranchDialog();
			}
		} finally {
			busy = false;
		}
	}

	// Step two. The branch already exists; we only decide what to do with the
	// uncommitted changes. "Bring" switches onto the new branch (the working
	// tree follows); "leave" stays put. Either way we close when done.
	async function finish(e?: Event): Promise<void> {
		e?.preventDefault();
		if (busy) return;
		if (bringChoice === 'bring') {
			busy = true;
			try {
				const ok = await actions.checkoutBranch(name.trim());
				if (!ok) return;
			} finally {
				busy = false;
			}
		}
		actions.closeCreateBranchDialog();
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

<Dialog.Root
	open={app.createBranchDialogOpen}
	onOpenChange={(v) => (v ? actions.openCreateBranchDialog() : actions.closeCreateBranchDialog())}
>
	<Dialog.Content class="overflow-hidden sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				{#if step === 'base'}
					<GitBranch class="size-4" />
					Create a Branch
				{:else}
					<Check class="size-4 text-success" />
					Branch created
				{/if}
			</Dialog.Title>
		</Dialog.Header>

		{#if step === 'base'}
			<form class="grid gap-4" onsubmit={create}>
				<div class="grid gap-1.5">
					<label for="create-branch-name" class="text-xs font-medium">Name</label>
					<Input
						id="create-branch-name"
						type="text"
						bind:value={name}
						placeholder="new-branch-name"
						class="font-mono text-xs"
						disabled={busy}
						autofocus
					/>
				</div>

				{#if defaultBranch || showCurrentOption}
					<div class="grid gap-2">
						<div class="text-xs font-medium">Create branch based on…</div>
						<RadioGroup bind:value={baseChoice} disabled={busy} class="gap-2">
							{#if defaultBranch}
								{@render optionCard(
									'branch-base-default',
									'default',
									defaultBranch,
									"The default branch in your repository. Pick this to start on something new that's not dependent on your current branch."
								)}
							{/if}
							{#if showCurrentOption && currentBranch}
								{@render optionCard(
									'branch-base-current',
									'current',
									currentBranch,
									'The currently checked out branch. Pick this if you need to build on work done on this branch.'
								)}
							{/if}
						</RadioGroup>
					</div>
				{/if}

				{#if error}
					<div
						class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						{error}
					</div>
				{/if}

				<Dialog.Footer>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={busy}
						onclick={() => actions.closeCreateBranchDialog()}
					>
						Cancel
					</Button>
					<Button type="submit" size="sm" disabled={!canCreate}>
						{#if busy}
							<Loader2 class="size-3.5 animate-spin" /> Creating…
						{:else}
							Create
						{/if}
					</Button>
				</Dialog.Footer>
			</form>
		{:else}
			<form class="grid gap-4" onsubmit={finish}>
				<p class="text-xs text-muted-foreground">
					<span class="font-mono">{name.trim()}</span> is ready. You have uncommitted changes on
					<span class="font-mono">{currentBranch}</span> — where should they go?
				</p>

				<RadioGroup bind:value={bringChoice} disabled={busy} class="gap-2">
					{@render optionCard(
						'branch-bring-bring',
						'bring',
						`Take them to ${name.trim() || 'new branch'}`,
						'Switch to the new branch. Your uncommitted changes come along.'
					)}
					{@render optionCard(
						'branch-bring-leave',
						'leave',
						`Keep them on ${currentBranch}`,
						'Stay here and keep working. The new branch waits for you.'
					)}
				</RadioGroup>

				{#if error}
					<div
						class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						{error}
					</div>
				{/if}

				<Dialog.Footer>
					<Button type="submit" size="sm" disabled={busy}>
						{#if busy}
							<Loader2 class="size-3.5 animate-spin" /> Switching…
						{:else}
							Done
						{/if}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
