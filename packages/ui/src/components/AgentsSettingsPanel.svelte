<script lang="ts">
	// Settings → Agents: which installed coding-agent CLI Super Review runs, and
	// with which model. One default for the app: the same CLI writes commit
	// messages and changesets. What it is asked to write lives in Settings →
	// Prompts, the skill files it reads live in Settings → Skills.
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import { Button } from './ui/button';
	import CommitMessageModelPicker from './CommitMessageModelPicker.svelte';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app, effectiveCommitMessageHarness } from '@super-review/ui/store.svelte';
	import { cn } from '@super-review/ui/utils';
	import {
		COMMIT_MESSAGE_HARNESS_PRIORITY,
		harnessLabel,
		type CommitMessageHarness
	} from '@super-review/core/types';

	// Re-detect on open so the list reflects a CLI installed since launch.
	onMount(() => {
		void actions.refreshCommitMessageHarnesses();
	});

	const harnessStatus = $derived(app.commitMessageHarnesses);
	// Pref when set and installed; otherwise the first installed CLI (auto-fallback).
	const selectedHarness = $derived(effectiveCommitMessageHarness());

	function selectCommitMessageHarness(harness: CommitMessageHarness): void {
		if (!harnessStatus?.[harness]) return;
		void actions.setCommitMessageHarness(harness);
	}
</script>

<section id="settings-commit-messages" class="scroll-mt-4">
	<h3 class="text-base font-semibold">Agent CLI</h3>
	<p class="mt-1 text-xs text-muted-foreground">
		Configure the harness and model used to generate commit messages and changesets.
	</p>

	<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card/30">
		{#each COMMIT_MESSAGE_HARNESS_PRIORITY as harness (harness)}
			{@const installed = harnessStatus?.[harness] ?? false}
			{@const selected = selectedHarness === harness}
			<div
				class={cn(
					'flex min-h-13 items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0',
					!installed && 'opacity-50'
				)}
			>
				<HarnessLogo {harness} size={20} class="shrink-0" />
				<span class="flex-1 truncate text-sm">{harnessLabel(harness)}</span>
				{#if harnessStatus === null}
					<span class="text-xs text-muted-foreground">Detecting…</span>
				{:else if !installed}
					<span class="text-xs text-muted-foreground">Not installed</span>
				{:else}
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
