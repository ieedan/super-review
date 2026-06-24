<script lang="ts">
	// The stack of dismissible notices shown above the commit box, front-first:
	//  - "Some changesets may be unnecessary" (warning) — a changeset references a
	//    package with no actual changes on this branch.
	//  - "Add a changeset?" — a releasable package changed but no changeset covers
	//    it yet.
	//  - "Install the skill" — the super-review skill isn't installed in this repo,
	//    so coding agents can't document their changes here for review.
	// They render through Stack, which arranges them like a Sonner stack (hover to
	// expand, dismiss one by one with a smooth exit).
	import OfflineIcon from '@iconify/svelte/dist/OfflineIcon.svelte';
	import { actions, app } from '$lib/store.svelte';
	import { SUPER_REVIEW_ICON } from '$lib/file-icons';
	import { Button } from './ui/button';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import InstallSkillButton from './InstallSkillButton.svelte';
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

	// The skill check returns false only on a definitive "not installed"; null
	// (unknown / still checking) keeps the prompt hidden rather than flashing it.
	const showSkill = $derived(app.skillInstalled === false && !app.skillInstallDismissed);

	type Notice = { id: 'warning' | 'add' | 'skill' };

	// Front-first (index 0 is the fully-visible front card; later ones peek behind
	// it). "Add a changeset?" leads, then the skill nudge, and the unnecessary-
	// changeset warning sits at the back of the pile.
	const notices = $derived.by(() => {
		const list: Notice[] = [];
		if (showAdd) list.push({ id: 'add' });
		if (showSkill) list.push({ id: 'skill' });
		if (showWarning) list.push({ id: 'warning' });
		return list;
	});

	// Stack animates the card out, then calls this so we run the actual dismissal
	// (which drops the notice from `notices` via the reactive flags above).
	function dismissNotice(n: Notice): void {
		if (n.id === 'warning') actions.dismissChangesetWarning();
		else if (n.id === 'add') actions.dismissChangesetPrompt();
		else actions.dismissSkillInstall();
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
				{:else}
					<NoticeCard
						onDismiss={dismiss}
						dismissTitle="Dismiss"
						tooltip="Install the super-review skill so coding agents can document their changes here for review."
					>
						{#snippet logo()}
							<OfflineIcon icon={SUPER_REVIEW_ICON} class="size-4 shrink-0" />
						{/snippet}
						Install the skill?
						{#snippet action()}
							<InstallSkillButton size="xs" variant="outline" label="Install" />
						{/snippet}
					</NoticeCard>
				{/if}
			{/snippet}
		</Stack>
	</div>
{/if}
