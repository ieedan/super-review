<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		ChevronDown,
		GitMerge,
		GitPullRequest,
		Loader2,
		TriangleAlert,
		User
	} from 'lucide-svelte';
	import { Button } from './ui/button';
	import * as Avatar from './ui/avatar';
	import { Input } from './ui/input';
	import { Textarea } from './ui/textarea';
	import AccountSwitcher from './AccountSwitcher.svelte';
	import { actions, app, effectiveGithubAccount } from '$lib/store.svelte';

	let summary = $state('');
	let description = $state('');

	// Restore the persisted draft whenever the active repo changes. Tracked
	// separately from `app.activeRepo` so we only reload on an actual switch,
	// not on every metadata refresh.
	let loadedRepoId: string | null = null;
	$effect(() => {
		const repoId = app.activeRepo?.id ?? null;
		if (repoId === loadedRepoId) return;
		loadedRepoId = repoId;
		if (!repoId) {
			summary = '';
			description = '';
			return;
		}
		void window.api.state.getCommitDraft(repoId).then((draft) => {
			// A faster switch may have superseded this load — ignore stale results.
			if (app.activeRepo?.id !== repoId) return;
			summary = draft.summary;
			description = draft.description;
		});
	});

	// Debounce persistence so we're not writing the store on every keystroke.
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function persistDraft(): void {
		const repoId = app.activeRepo?.id;
		if (!repoId) return;
		clearTimeout(saveTimer);
		const snapshot = { summary, description };
		saveTimer = setTimeout(() => {
			void window.api.state.setCommitDraft(repoId, snapshot);
		}, 300);
	}

	function clearDraft(repoId: string): void {
		clearTimeout(saveTimer);
		void window.api.state.setCommitDraft(repoId, { summary: '', description: '' });
	}

	onDestroy(() => clearTimeout(saveTimer));

	const busy = $derived(app.push.inProgress && app.push.stage === 'committing');
	// Only the checked files get committed (see the Unstaged tab checkboxes).
	// Everything is included unless explicitly excluded.
	const fileCount = $derived(
		app.changedFiles.filter((f) => !app.excludedFromCommit.has(f.path)).length
	);
	const branch = $derived(app.currentBranch ?? 'detached HEAD');
	// A merge in progress can only be concluded with a whole-index commit: git
	// rejects the per-file pathspec commit we normally build. The file selection
	// and line-level staging don't apply — every staged change is committed
	// together as the merge commit — so we relax the "files checked" gate (the
	// merge itself is always something to commit) and warn the user below.
	const mergeInProgress = $derived(app.pushStatus?.mergeInProgress ?? false);
	const canCommit = $derived(
		!busy && (mergeInProgress || fileCount > 0) && summary.trim().length > 0
	);

	// No write access to origin — committing/pushing has to go through a fork
	// first (GitHub Desktop parity). false only on a definitive "no" from the API.
	const needsFork = $derived(app.repoPushAccess === false);

	async function submit(e?: Event): Promise<void> {
		e?.preventDefault();
		if (!canCommit) return;
		// Can't push to this repo — ask to fork first; the message rides along and
		// the commit runs once the fork exists (see actions.confirmFork).
		if (needsFork) {
			actions.promptFork('commit', { summary, description });
			return;
		}
		const repoId = app.activeRepo?.id;
		const ok = await actions.commit(summary, description);
		if (ok) {
			summary = '';
			description = '';
			if (repoId) clearDraft(repoId);
		}
	}

	// Clear the box once a commit-intent fork resolves successfully (the commit
	// ran inside confirmFork, so submit() never got to clear it here). A cancel
	// leaves repoPushAccess false, so the text is preserved.
	let prevForkIntent: 'commit' | 'push' | null = null;
	$effect(() => {
		const intent = app.forkPrompt?.intent ?? null;
		if (prevForkIntent === 'commit' && app.forkPrompt === null && app.repoPushAccess === true) {
			const repoId = app.activeRepo?.id;
			summary = '';
			description = '';
			if (repoId) clearDraft(repoId);
		}
		prevForkIntent = intent;
	});

	function onKeydown(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submit();
		}
	}

	// Account this project authenticates as: its pinned account when set,
	// otherwise the app-wide default.
	const effectiveAccount = $derived(effectiveGithubAccount());

	// When the checked-out branch is a PR opened by someone else, committing here
	// targets their PR branch. We resolve actual push access (direct or via
	// maintainer-edit) so we can tell the user definitively whether a push will
	// land — rather than warning on every foreign PR.
	const foreignPR = $derived(
		app.branchPR && effectiveAccount && app.branchPR.author !== effectiveAccount.login
			? app.branchPR
			: null
	);
	// null = still resolving / unknown; true = pushable; false = will be rejected.
	const pushAccess = $derived(app.branchPRPushAccess);

	const lastCommit = $derived(app.lastCommit);
	const canUndo = $derived(!busy && (lastCommit?.canUndo ?? false));

	async function undo(): Promise<void> {
		if (!canUndo) return;
		await actions.undoLastCommit();
	}
</script>

<form class="flex flex-col gap-1.5 border-t border-border bg-card/40 p-2" onsubmit={submit}>
	<div class="flex items-center gap-2">
		<AccountSwitcher
			align="start"
			side="top"
			heading="Account for this project"
			selectedAccountId={effectiveAccount?.id}
			defaultAccountId={app.activeGithubAccount?.id}
			isPinned={!!app.activeRepo?.githubAccountId}
			onSelectAccount={(id) => actions.setRepoGithubAccount(id)}
			onUseDefault={() => actions.setRepoGithubAccount(null)}
			triggerTitle={effectiveAccount
				? `This project uses ${effectiveAccount.login}. Click to switch`
				: 'Select an account for this project'}
			triggerClass="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{#snippet trigger()}
				<Avatar.Root class="size-7">
					{#if effectiveAccount?.avatarUrl}
						<Avatar.Image src={effectiveAccount.avatarUrl} alt={effectiveAccount.login} />
					{/if}
					<Avatar.Fallback class="text-[10px]">
						{#if effectiveAccount}
							{effectiveAccount.login.slice(0, 2).toUpperCase()}
						{:else}
							<User class="size-3.5" />
						{/if}
					</Avatar.Fallback>
				</Avatar.Root>
				<span
					class="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
				>
					<ChevronDown class="size-2" />
				</span>
			{/snippet}
		</AccountSwitcher>
		<Input
			type="text"
			bind:value={summary}
			oninput={persistDraft}
			placeholder="Summary (required)"
			disabled={busy}
			class="h-7 min-w-0 flex-1 text-xs"
		/>
	</div>

	<Textarea
		bind:value={description}
		oninput={persistDraft}
		onkeydown={onKeydown}
		placeholder="Description"
		rows={3}
		disabled={busy}
		class="min-h-0 resize-none px-2 py-1.5 text-xs"
	/>

	{#if mergeInProgress}
		<div
			class="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-muted-foreground"
		>
			<GitMerge class="mt-0.5 size-3.5 shrink-0 text-warning" />
			<span>
				A merge is in progress. Git commits the whole merge at once, so <span
					class="font-medium text-foreground">all staged changes are committed together</span
				> — the per-file and line selections don't apply here.
			</span>
		</div>
	{/if}

	{#if needsFork}
		<div
			class="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-muted-foreground"
		>
			<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" />
			<span>
				You don't have write access to <span class="font-medium text-foreground"
					>{app.activeRepo?.githubOwner}/{app.activeRepo?.githubRepo}</span
				>. Want to
				<button
					type="button"
					class="font-medium text-foreground underline underline-offset-2 hover:text-primary"
					onclick={() => actions.promptFork('push')}>create a fork</button
				>?
			</span>
		</div>
	{/if}

	{#if foreignPR && pushAccess === false}
		<div
			class="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-muted-foreground"
		>
			<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />
			<span>
				You can't push to <span class="font-medium text-foreground">@{foreignPR.author}</span>'s PR
				branch, so these commits can't be pushed back to the PR.
			</span>
		</div>
	{:else if foreignPR && pushAccess === true}
		<div
			class="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground"
		>
			<GitPullRequest class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			<span>
				Commits will be pushed to <span class="font-medium text-foreground"
					>@{foreignPR.author}</span
				>'s PR branch.
			</span>
		</div>
	{/if}

	<Button type="submit" size="sm" class="w-full" disabled={!canCommit}>
		{#if busy}
			<Loader2 class="size-3.5 animate-spin" />
			<span class="text-xs">Committing…</span>
		{:else if mergeInProgress}
			<span class="truncate text-xs">
				Commit merge to <span class="font-semibold">{branch}</span>
			</span>
		{:else}
			<span class="truncate text-xs">
				Commit
				{#if fileCount > 0}
					{fileCount} file{fileCount === 1 ? '' : 's'}
				{/if}
				to <span class="font-semibold">{branch}</span>
			</span>
		{/if}
	</Button>
</form>

{#if canUndo && lastCommit}
	<div class="flex items-center gap-2 border-t border-border bg-card/40 px-2 py-1.5">
		<div class="min-w-0 flex-1">
			<p class="truncate text-[11px] text-muted-foreground">
				Committed {lastCommit.relativeTime}
			</p>
			<p class="truncate text-xs">{lastCommit.subject}</p>
		</div>
		<Button type="button" size="sm" variant="outline" class="h-7 shrink-0 text-xs" onclick={undo}>
			Undo
		</Button>
	</div>
{/if}
