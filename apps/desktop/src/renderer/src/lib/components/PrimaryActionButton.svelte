<script lang="ts">
	import {
		ArrowUp,
		ArrowUpFromLine,
		Check,
		ExternalLink,
		GitPullRequest,
		GitPullRequestArrow,
		Loader2,
		X
	} from 'lucide-svelte';
	import { Button } from './ui/button';
	import * as Tooltip from './ui/tooltip';
	import GithubSpinner from './GithubSpinner.svelte';
	import { actions, app, isReadOnlyView, uiPR } from '$lib/store.svelte';
	import { cn } from '$lib/utils';
	import type { PRCheck } from '@shared/types';

	const status = $derived(app.pushStatus);
	// The PR the button acts on — follows what's on screen (a viewed PR/branch in
	// read-only mode, else the checked-out branch's PR).
	const pr = $derived(uiPR());
	// In a read-only view the working tree isn't this branch, so publish/push/
	// commit make no sense — the only meaningful action is opening the PR (if any)
	// for whatever's being viewed.
	const readOnly = $derived(isReadOnlyView());
	const stage = $derived(app.push.stage);
	// Spin ONLY for this button's own push/publish operation. Other in-flight git
	// ops (pull, update branch, commit) keep the button disabled (see `disabled`
	// below) but must not spin it — otherwise the header shows two spinners at
	// once (e.g. the update-branch spinner plus a phantom one here). While stage
	// is 'conflicts' the flow is paused on the conflict dialog, not working.
	const busy = $derived(app.push.inProgress && app.push.op === 'push' && stage !== 'conflicts');

	type Mode = 'publish' | 'push' | 'go-pr' | 'create-pr' | 'none';

	// Branch has commits the default branch doesn't — i.e. there's content to
	// open a PR for. 0 when on the default branch or when the branch hasn't
	// diverged from it.
	const branchHasChanges = $derived((status?.aheadOfDefault ?? 0) > 0);

	const mode = $derived.by<Mode>(() => {
		// Read-only view: only offer to open the viewed branch/PR's PR. No push/
		// publish/create — those act on the checked-out working tree, not this view.
		if (readOnly) return pr ? 'go-pr' : 'none';
		// No remote yet → offer to publish to GitHub (GitHub-Desktop style). This
		// also resolves the "I committed but there's no push button" dead end.
		if (status && !status.hasRemote) return 'publish';
		if (status?.hasRemote && (status.ahead > 0 || !status.hasUpstream)) return 'push';
		if (pr) return 'go-pr';
		if (branchHasChanges) return 'create-pr';
		return 'none';
	});

	const label = $derived.by(() => {
		if (busy) {
			switch (stage) {
				case 'fetching':
					return 'Fetching…';
				case 'pulling':
					return 'Pulling…';
				case 'pushing':
					return 'Pushing…';
				default:
					return 'Working…';
			}
		}
		switch (mode) {
			case 'publish':
				return 'Publish';
			case 'push':
				return status && status.ahead > 0 ? `Push ${status.ahead}` : 'Publish';
			case 'go-pr':
				return `PR #${pr?.number}`;
			case 'create-pr':
				return 'Create PR';
			case 'none':
				return '';
		}
	});

	const Icon = $derived.by(() => {
		if (busy) return Loader2;
		switch (mode) {
			case 'publish':
				return ArrowUpFromLine;
			case 'push':
				return status?.hasUpstream ? ArrowUp : ArrowUpFromLine;
			case 'go-pr':
				return ExternalLink;
			case 'create-pr':
				return GitPullRequest;
			case 'none':
				return GitPullRequest;
		}
	});

	const disabled = $derived.by(() => {
		// Opening a PR from a read-only view is always safe (just a link).
		if (readOnly) return false;
		// Lock the button during ANY in-flight git operation (the store also guards
		// each action on app.push.inProgress), even ones that don't spin this button.
		if (app.push.inProgress) return true;
		if (mode === 'publish') return false; // dialog handles the not-signed-in case
		if (mode === 'push') return !status?.hasRemote;
		// PR actions require a GitHub-linked repo.
		return !app.activeRepo?.githubOwner || !app.activeRepo?.githubRepo;
	});

	function click(): void {
		switch (mode) {
			case 'publish':
				actions.openPublishDialog();
				return;
			case 'push':
				void actions.push();
				return;
			case 'go-pr':
				// Open the specific PR that's on screen (viewed PR/branch in read-only
				// mode, or the checked-out branch's PR), rather than always the
				// checked-out branch's.
				if (pr?.url) {
					void window.api.shell.openExternal(pr.url);
					return;
				}
				void actions.openPRPage();
				return;
			case 'create-pr':
				void actions.openPRPage();
				return;
		}
	}

	// CI/workflow status for the branch PR's head commit, guarded so a stale poll
	// result can't paint the wrong PR. `null`/`'none'` means there's nothing to
	// show, in which case we fall back to the plain PR icon.
	// CI checks are polled only for the checked-out branch's PR, so don't try to
	// show them in a read-only view (the button there is a plain "open PR" link).
	const checks = $derived(
		!readOnly && app.branchPRChecks && app.branchPRChecks.number === app.branchPR?.number
			? app.branchPRChecks.summary
			: null
	);
	const checksState = $derived(checks && checks.state !== 'none' ? checks.state : null);

	const checksTitle = $derived.by(() => {
		switch (checksState) {
			case 'success':
				return 'Checks passing';
			case 'failure':
				return 'Checks failing';
			case 'pending':
				return 'Checks running';
			default:
				return '';
		}
	});

	function fmtDuration(ms: number | null): string {
		if (ms == null) return '';
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		const rem = s % 60;
		return rem ? `${m}m ${rem}s` : `${m}m`;
	}

	// GitHub-style phrasing for a check's outcome, e.g. "Failing after 2m",
	// "Successful in 25s", "In progress".
	function statusText(check: PRCheck): string {
		const d = fmtDuration(check.durationMs);
		switch (check.state) {
			case 'failure':
				return d ? `Failing after ${d}` : 'Failing';
			case 'success':
				return d ? `Successful in ${d}` : 'Successful';
			default:
				return 'In progress';
		}
	}

	// Grouped for the hover breakdown, failing first like GitHub.
	const failing = $derived(checks?.checks.filter((c) => c.state === 'failure') ?? []);
	const running = $derived(checks?.checks.filter((c) => c.state === 'pending') ?? []);
	const passing = $derived(checks?.checks.filter((c) => c.state === 'success') ?? []);

	function plural(n: number, word: string): string {
		return `${n} ${word}${n === 1 ? '' : 's'}`;
	}

	const title = $derived.by(() => {
		switch (mode) {
			case 'publish':
				return 'Publish this repository to GitHub';
			case 'push': {
				const remote = status?.pushRemote ?? 'origin';
				if (!status?.hasUpstream) return 'Publish branch to origin';
				return `Push ${status.ahead} commit${status.ahead === 1 ? '' : 's'} to ${remote}`;
			}
			case 'go-pr':
				return pr ? `Open PR #${pr.number}` : 'Open PR';
			case 'create-pr':
				return 'Open the create-pull-request page on GitHub';
			case 'none':
				return '';
		}
	});
</script>

{#if app.activeRepo && mode !== 'none'}
	<Button
		variant={mode === 'go-pr' ? 'secondary' : 'default'}
		size="sm"
		{disabled}
		onclick={click}
		{title}
	>
		<Icon class={cn('size-3.5', busy && 'animate-spin')} />
		<span class="text-xs">{label}</span>
		{#if mode === 'go-pr' && !busy}
			{#if checks && checks.checks.length > 0}
				<Tooltip.Provider delayDuration={150}>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<span {...props} class="inline-flex items-center" aria-label={checksTitle}>
									{@render indicator()}
								</span>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content
							side="bottom"
							class="border border-border bg-popover p-0 text-popover-foreground shadow-md"
							arrowClasses="bg-popover fill-popover"
						>
							<div class="flex max-h-80 w-80 flex-col overflow-y-auto py-1">
								{#if failing.length > 0}
									{@render group(plural(failing.length, 'failing check'), failing)}
								{/if}
								{#if running.length > 0}
									{@render group(`${running.length} in progress`, running)}
								{/if}
								{#if passing.length > 0}
									{@render group(plural(passing.length, 'successful check'), passing)}
								{/if}
							</div>
						</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			{:else}
				{@render indicator()}
			{/if}
		{/if}
	</Button>
{/if}

{#snippet indicator()}
	{#if checksState === 'success'}
		<Check class="size-3.5 text-green-500" aria-label={checksTitle} />
	{:else if checksState === 'failure'}
		<X class="size-3.5 text-red-500" aria-label={checksTitle} />
	{:else if checksState === 'pending'}
		<GithubSpinner class="text-[#d29922]" aria-label={checksTitle} />
	{:else}
		<GitPullRequestArrow class="size-3 text-muted-foreground" />
	{/if}
{/snippet}

{#snippet group(label: string, items: PRCheck[])}
	<div class="px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
	{#each items as check (check.name)}
		<div class="flex items-center gap-2 px-2.5 py-1 text-xs">
			{#if check.state === 'success'}
				<Check class="size-3.5 shrink-0 text-green-500" />
			{:else if check.state === 'failure'}
				<X class="size-3.5 shrink-0 text-red-500" />
			{:else}
				<GithubSpinner class="size-3.5 shrink-0 text-[#d29922]" />
			{/if}
			{#if check.avatarUrl}
				<img src={check.avatarUrl} alt="" class="size-3.5 shrink-0 rounded-full" />
			{/if}
			<span class="truncate" title={check.name}>{check.name}</span>
			<span class="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">
				{statusText(check)}
			</span>
		</div>
	{/each}
{/snippet}
