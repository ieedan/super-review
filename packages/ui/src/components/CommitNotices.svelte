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
	import UpdateNotice from './UpdateNotice.svelte';

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

	// Trial nudge — rides the same stack. Reappears once per calendar day
	// (dismissing hides it for the rest of the day) until the license stops being
	// a trial (subscribe or buy), after which it never shows.
	const trialDaysLeft = $derived.by(() => {
		const lic = app.license.current;
		if (lic?.state !== 'licensed' || lic.status !== 'trialing' || !lic.trialEndsAt) return null;
		return Math.max(0, Math.ceil((lic.trialEndsAt - Date.now()) / 86_400_000));
	});
	const TRIAL_KEY = 'sr-trial-notice-dismissed';
	function trialDayKey(): string {
		const d = new Date();
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	}
	function readTrialDismissed(): boolean {
		try {
			return localStorage.getItem(TRIAL_KEY) === trialDayKey();
		} catch {
			return false;
		}
	}
	let trialDismissed = $state(readTrialDismissed());
	const showTrial = $derived(trialDaysLeft !== null && !trialDismissed);

	// App auto-update: rides the same stack. Visible while downloading, and once
	// downloaded until dismissed (the store un-dismisses when a newer download
	// starts). The `update` payload itself lives in the store, mirrored from the
	// main process (see initUpdater).
	const update = $derived(app.update);
	const showUpdate = $derived(
		update.state === 'downloading' || (update.state === 'downloaded' && !app.updateDismissed)
	);

	type Notice = { id: 'warning' | 'add' | 'ai-config' | 'ai-config-update' | 'trial' | 'update' };

	// Front-first (index 0 is the fully-visible front card; later ones peek behind
	// it). An app update leads (it's the most consequential prompt and the user
	// asked for it up front), then the trial nudge, "Add a changeset?", the
	// AI-config nudge, and the unnecessary-changeset warning at the back.
	const notices = $derived.by(() => {
		const list: Notice[] = [];
		if (showUpdate) list.push({ id: 'update' });
		if (showTrial) list.push({ id: 'trial' });
		if (showAdd) list.push({ id: 'add' });
		if (showConfigure) list.push({ id: 'ai-config' });
		if (showConfigUpdate) list.push({ id: 'ai-config-update' });
		if (showWarning) list.push({ id: 'warning' });
		return list;
	});

	// Stack animates the card out, then calls this so we run the actual dismissal
	// (which drops the notice from `notices` via the reactive flags above).
	function dismissNotice(n: Notice): void {
		if (n.id === 'update') actions.dismissUpdate();
		else if (n.id === 'trial') {
			try {
				localStorage.setItem(TRIAL_KEY, trialDayKey());
			} catch {
				// non-fatal: dismissal just won't persist
			}
			trialDismissed = true;
		} else if (n.id === 'warning') actions.dismissChangesetWarning();
		else if (n.id === 'add') actions.dismissChangesetPrompt();
		else if (n.id === 'ai-config-update') actions.dismissAiConfigUpdate();
		else actions.dismissAiConfigNotice();
	}
</script>

{#if notices.length > 0}
	<div class="mx-2 mt-2 mb-2">
		<Stack items={notices} onDismiss={dismissNotice} gap={8}>
			{#snippet card(n, { dismiss })}
				{#if n.id === 'update'}
					<UpdateNotice
						status={update}
						onRestart={() => actions.restartToUpdate()}
						onDismiss={dismiss}
					/>
				{:else if n.id === 'trial'}
					<NoticeCard
						onDismiss={dismiss}
						dismissTitle="Dismiss for today"
						tooltip="Subscribe or buy a perpetual license to keep using Super Review after your trial."
					>
						{#snippet logo()}
							<!-- size-5 (not size-4 like the AI-config notices): the brand tile
							     has ~9% padding in its viewBox, so it needs to be a touch larger
							     to match the changeset butterfly's visual height. -->
							<OfflineIcon icon={SUPER_REVIEW_ICON} class="size-5 shrink-0" />
						{/snippet}
						{trialDaysLeft === 0
							? 'Trial ends today'
							: `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in trial`}
						{#snippet action()}
							<Button
								type="button"
								size="xs"
								variant="outline"
								class="border-flame/40 text-flame hover:bg-flame/10 h-6 text-[11px]"
								onclick={() => actions.openPricing()}
							>
								Upgrade
							</Button>
						{/snippet}
					</NoticeCard>
				{:else if n.id === 'warning'}
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
