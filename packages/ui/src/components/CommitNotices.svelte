<script lang="ts">
	// The stack of dismissible notices shown above the commit box, front-first:
	//  - "Some changesets may be unnecessary" (warning) — a changeset references a
	//    package with no actual changes on this branch.
	//  - "Add a changeset?" — a releasable package changed but no changeset covers
	//    it yet.
	//  - "Configure AI files" — nothing is configured in this repo yet, so coding
	//    agents can't document their changes here for review.
	// They render through Stack, which arranges them like a Sonner stack (hover to
	// expand, dismiss one by one with a smooth exit).
	import OfflineIcon from '@iconify/svelte/dist/OfflineIcon.svelte';
	import { actions, app } from '@super-review/ui/store.svelte';
	import { SUPER_REVIEW_ICON } from '@super-review/ui/file-icons';
	import { Button } from './ui/button';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import ConfigureAiButton from './ConfigureAiButton.svelte';
	import NoticeCard from './NoticeCard.svelte';
	import Stack from './stack/Stack.svelte';

	const showAdd = $derived(
		(app.changesetStatus?.needsChangeset ?? false) && !app.changesetPromptDismissed
	);

	// Packages bumped by a changeset *newly added* on this branch but with no actual
	// changes — that changeset is likely unnecessary. Editing the bumps of a changeset
	// that was already here doesn't count: we only flag a changeset we'd offer to add.
	const unnecessary = $derived.by(() => {
		const s = app.changesetStatus;
		if (!s) return [];
		const changed = new Set(s.changedPackages);
		const addedCovered = new Set(
			s.branchChangesets.filter((c) => c.added).flatMap((c) => c.packages)
		);
		return [...addedCovered].filter((p) => !changed.has(p));
	});
	const showWarning = $derived(unnecessary.length > 0 && !app.changesetWarningDismissed);

	// `anyInstalled === false` is a definitive "nothing configured"; a null status
	// (unknown / still checking) keeps the prompt hidden rather than flashing it.
	const showConfigure = $derived(
		app.aiConfigStatus?.anyInstalled === false && !app.aiConfigNoticeDismissed
	);

	// Offer an update when something is configured but behind the bundled copy.
	// Requires anyInstalled, so this and showConfigure are mutually exclusive.
	const showConfigUpdate = $derived(
		app.aiConfigStatus?.anyUpdateAvailable === true && !app.aiConfigUpdateDismissed
	);

	type Notice = { id: 'warning' | 'add' | 'ai-config' | 'ai-config-update' };

	// Front-first (index 0 is the fully-visible front card; later ones peek behind
	// it). "Add a changeset?" leads, then the AI-config nudge, and the unnecessary-
	// changeset warning sits at the back of the pile.
	const notices = $derived.by(() => {
		const list: Notice[] = [];
		if (showAdd) list.push({ id: 'add' });
		if (showConfigure) list.push({ id: 'ai-config' });
		if (showConfigUpdate) list.push({ id: 'ai-config-update' });
		if (showWarning) list.push({ id: 'warning' });
		return list;
	});

	// Stack animates the card out, then calls this so we run the actual dismissal
	// (which drops the notice from `notices` via the reactive flags above).
	function dismissNotice(n: Notice): void {
		if (n.id === 'warning') actions.dismissChangesetWarning();
		else if (n.id === 'add') actions.dismissChangesetPrompt();
		else if (n.id === 'ai-config-update') actions.dismissAiConfigUpdate();
		else actions.dismissAiConfigNotice();
	}
</script>

{#if notices.length > 0}
	<div class="mx-2 mt-2 mb-2">
		<Stack items={notices} onDismiss={dismissNotice} gap={8}>
			{#snippet card(n, { dismiss })}
				{#if n.id === 'warning'}
					<NoticeCard
						variant="warning"
						onDismiss={dismiss}
						dismissTitle="Dismiss for this branch"
						tooltip={`No changes detected for ${unnecessary.join(', ')} — their changeset may be unnecessary.`}
					>
						{#snippet logo()}
							<ChangesetLogo class="h-4 w-auto shrink-0" />
						{/snippet}
						Some changesets may be unnecessary
						{#snippet action()}
							<Button
								type="button"
								size="xs"
								variant="outline"
								class="h-6 border-warning/40 text-[11px] hover:bg-warning/10"
								onclick={() => actions.openChangesetReview()}
							>
								View
							</Button>
						{/snippet}
					</NoticeCard>
				{:else if n.id === 'add'}
					<NoticeCard onDismiss={dismiss} dismissTitle="Dismiss for this branch">
						{#snippet logo()}
							<ChangesetLogo class="h-4 w-auto shrink-0" />
						{/snippet}
						Add a changeset?
						{#snippet action()}
							<Button
								type="button"
								size="xs"
								variant="outline"
								class="h-6 text-[11px]"
								onclick={() => actions.openChangesetDialog()}
							>
								Add
							</Button>
						{/snippet}
					</NoticeCard>
				{:else if n.id === 'ai-config-update'}
					<NoticeCard
						onDismiss={dismiss}
						dismissTitle="Dismiss"
						tooltip="A newer version of the super-review skill is available. Update it so agents follow the latest workflow."
					>
						{#snippet logo()}
							<OfflineIcon icon={SUPER_REVIEW_ICON} class="size-4 shrink-0" />
						{/snippet}
						Update AI files?
						{#snippet action()}
							<ConfigureAiButton size="xs" variant="outline" label="Update" />
						{/snippet}
					</NoticeCard>
				{:else}
					<NoticeCard
						onDismiss={dismiss}
						dismissTitle="Dismiss"
						tooltip="Configure the super-review skills so coding agents can document their changes here for review."
					>
						{#snippet logo()}
							<OfflineIcon icon={SUPER_REVIEW_ICON} class="size-4 shrink-0" />
						{/snippet}
						Configure AI files?
						{#snippet action()}
							<ConfigureAiButton size="xs" variant="outline" label="Configure" />
						{/snippet}
					</NoticeCard>
				{/if}
			{/snippet}
		</Stack>
	</div>
{/if}
