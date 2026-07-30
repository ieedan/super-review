<script lang="ts">
	// Settings → Agents: which installed coding-agent CLI Super Review runs, and
	// with which model. One default for the app: the same CLI writes commit
	// messages and changesets. What it is asked to write lives in Settings →
	// Prompts, the skill files it reads live in Settings → Skills.
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from './ui/button';
	import * as Tooltip from './ui/tooltip';
	import CommitMessageModelPicker from './CommitMessageModelPicker.svelte';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app, effectiveCommitMessageHarness } from '@super-review/ui/store.svelte';
	import { cn } from '@super-review/ui/utils';
	import {
		COMMIT_MESSAGE_HARNESS_PRIORITY,
		harnessLabel,
		harnessLoginRecipe,
		isHarnessInstalled,
		type CommitMessageHarness
	} from '@super-review/core/types';

	// Re-detect on open so the list reflects a CLI installed — or signed into —
	// since launch. Forced, because "I opened settings to check" is exactly when a
	// cached auth answer is the wrong one to show.
	onMount(() => {
		void actions.refreshCommitMessageHarnesses({ force: true });
	});

	const harnessStatus = $derived(app.commitMessageHarnesses);
	// Pref when set and installed; otherwise the first installed CLI (auto-fallback).
	const selectedHarness = $derived(effectiveCommitMessageHarness());

	let copiedHarness = $state<CommitMessageHarness | null>(null);
	let copyResetId: number | undefined;

	function selectCommitMessageHarness(harness: CommitMessageHarness): void {
		if (!isHarnessInstalled(harnessStatus, harness)) return;
		void actions.setCommitMessageHarness(harness);
	}

	function copyLoginCommand(harness: CommitMessageHarness): void {
		void navigator.clipboard.writeText(harnessLoginRecipe(harness).command);
		copiedHarness = harness;
		clearTimeout(copyResetId);
		copyResetId = window.setTimeout(() => (copiedHarness = null), 1500);
	}
</script>

<section id="settings-commit-messages" class="scroll-mt-4">
	<h3 class="text-base font-semibold">Agent CLI</h3>
	<p class="mt-1 text-xs text-muted-foreground">
		Configure the harness and model used to generate commit messages and changesets.
	</p>

	<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card/30">
		{#each COMMIT_MESSAGE_HARNESS_PRIORITY as harness (harness)}
			{@const info = harnessStatus?.[harness]}
			{@const installed = info?.installed ?? false}
			{@const signedOut = installed && info?.auth === 'missing'}
			{@const selected = selectedHarness === harness}
			<div
				class={cn(
					'flex min-h-13 items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0',
					!installed && 'opacity-50'
				)}
			>
				<HarnessLogo {harness} size={20} class="shrink-0" />
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="truncate text-sm">{harnessLabel(harness)}</span>
					<!-- Second line only when there's something to say: the signed-in
					     identity, or the fix when there's no session. -->
					{#if signedOut}
						{@const recipe = harnessLoginRecipe(harness)}
						<span class="truncate text-xs text-warning">
							Not signed in &middot; run
							<code class="rounded bg-warning/15 px-1 py-px font-mono">{recipe.command}</code>
							{#if recipe.then}
								then
								<code class="rounded bg-warning/15 px-1 py-px font-mono">{recipe.then}</code>
							{/if}
						</span>
					{:else if info?.account || info?.plan}
						<span class="truncate text-xs text-muted-foreground">
							{[info.account, info.plan].filter(Boolean).join(' · ')}
						</span>
					{/if}
				</div>
				{#if harnessStatus === null}
					<span class="text-xs text-muted-foreground">Detecting…</span>
				{:else if !installed}
					<span class="text-xs text-muted-foreground">Not installed</span>
				{:else}
					{#if signedOut}
						<Tooltip.Provider delayDuration={150}>
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											class="shrink-0 rounded border border-warning/50 p-1 text-warning hover:bg-warning/15"
											onclick={() => copyLoginCommand(harness)}
											aria-label={`Copy the ${harnessLabel(harness)} login command`}
										>
											{#if copiedHarness === harness}
												<Check class="size-3.5" />
											{:else}
												<Copy class="size-3.5" />
											{/if}
										</button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content
									side="top"
									class="border border-border bg-popover text-popover-foreground shadow-md"
									arrowClasses="bg-popover fill-popover"
								>
									{copiedHarness === harness
										? 'Copied'
										: `Copy \`${harnessLoginRecipe(harness).command}\``}
								</Tooltip.Content>
							</Tooltip.Root>
						</Tooltip.Provider>
					{/if}
					<!-- Fixed width so the model pickers stay aligned whether the row
					     shows the badge or the button. -->
					<div class="flex w-32 shrink-0 justify-end">
						{#if selected}
							<span
								class="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success"
							>
								<Check class="size-3" /> Default
							</span>
						{:else}
							<Button variant="ghost" size="sm" onclick={() => selectCommitMessageHarness(harness)}>
								Set as default
							</Button>
						{/if}
					</div>
					<!-- Per-harness default model. Each row writes its own harness's
					     pref, so switching the default CLI keeps its model. -->
					<CommitMessageModelPicker {harness} align="end" class="w-40 shrink-0" />
				{/if}
			</div>
		{/each}
	</div>
</section>
