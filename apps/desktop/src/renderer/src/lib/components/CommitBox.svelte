<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import User from '@lucide/svelte/icons/user';
	import { Button } from './ui/button';
	import * as Avatar from './ui/avatar';
	import { Input } from './ui/input';
	import { Textarea } from './ui/textarea';
	import AccountSwitcher from './AccountSwitcher.svelte';
	import {
		actions,
		app,
		effectiveAccountAuthError,
		effectiveGithubAccount
	} from '$lib/store.svelte';
	import { isChangesetPath, parseChangesetMessage } from '$lib/changeset';

	let summary = $state('');
	let description = $state('');

	// Provenance of an auto-filled message: the changeset it came from plus the
	// exact text we wrote. Kept only while the box still matches that text — the
	// moment the user edits, we drop it (so the "detected" badge disappears and
	// their edit is never discarded). Powers the badge and the "remove the message
	// when its changeset is removed" behavior below.
	let detectedChangeset = $state<{ path: string; summary: string; description: string } | null>(
		null
	);

	// Restore the persisted draft whenever the active repo changes. Tracked
	// separately from `app.activeRepo` so we only reload on an actual switch,
	// not on every metadata refresh.
	let loadedRepoId: string | null = null;
	$effect(() => {
		const repoId = app.activeRepo?.id ?? null;
		if (repoId === loadedRepoId) return;
		loadedRepoId = repoId;
		detectedChangeset = null;
		if (!repoId) {
			summary = '';
			description = '';
			return;
		}
		void window.api.state.getCommitDraft(repoId).then((draft) => {
			// A faster switch may have superseded this load — ignore stale results.
			if (app.activeRepo?.id !== repoId) return;
			// A persisted `changesetPath` marks a draft whose text we auto-filled from a
			// changeset. We don't restore those: the message is re-derived live from the
			// working tree (see the effect below), so it only reappears while the changeset
			// is still an unstaged change. Restoring it here would resurrect the message
			// even after the changeset has been committed. Drop the stale draft.
			if (draft.changesetPath) {
				summary = '';
				description = '';
				detectedChangeset = null;
				clearDraft(repoId);
				return;
			}
			summary = draft.summary;
			description = draft.description;
			detectedChangeset = null;
		});
	});

	// Auto-fill the commit message from a freshly-added changeset. When exactly
	// one new changeset file (`.changeset/*.md`) is waiting in the working tree and
	// the box is still empty, use its hand-written description as the message — the
	// user writes good changesets and shouldn't have to retype them. We fill each
	// changeset at most once (tracked in `filledChangesets`) so we never fight a
	// user who deliberately clears the box, and reset on a repo switch.
	let changesetRepoId: string | null = null;
	// Plain Set on purpose: mutated inside the effect below, so it must stay
	// non-reactive or it would re-trigger that effect.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let filledChangesets = new Set<string>();
	$effect(() => {
		// Changesets integration disabled in settings — no auto-fill or provenance.
		if (!app.changesetsEnabled) return;
		const repoId = app.activeRepo?.id ?? null;
		const changesetPaths = app.changedFiles
			.filter((f) => (f.status === 'added' || f.status === 'untracked') && isChangesetPath(f.path))
			.map((f) => f.path);

		if (repoId !== changesetRepoId) {
			changesetRepoId = repoId;
			filledChangesets = new Set();
		}

		// Forget changesets that left the working tree (committed/discarded) so
		// re-creating one later fills again.
		const present = new Set(changesetPaths);
		for (const p of filledChangesets) {
			if (!present.has(p)) filledChangesets.delete(p);
		}

		// If the changeset our message was detected from is gone (e.g. removed via
		// the review dialog) and the box still matches it (provenance intact, since
		// any edit clears it), clear the message too — it's no longer wanted.
		const detected = untrack(() => detectedChangeset);
		if (detected && !present.has(detected.path)) {
			detectedChangeset = null;
			untrack(() => {
				summary = '';
				description = '';
				const rid = app.activeRepo?.id;
				if (rid) clearDraft(rid);
			});
		}

		if (!repoId || changesetPaths.length !== 1) return;
		const path = changesetPaths[0];
		if (filledChangesets.has(path)) return;
		// Read the box untracked so backspacing it to empty doesn't re-trigger us.
		if (untrack(() => summary.trim().length > 0 || description.trim().length > 0)) return;

		filledChangesets.add(path);
		void fillFromChangeset(repoId, path);
	});

	async function fillFromChangeset(repoId: string, filePath: string): Promise<void> {
		let diff;
		try {
			diff = await window.api.git.getDiff(repoId, filePath, { kind: 'workingTree' });
		} catch {
			return;
		}
		// The repo switched or the user started typing while we were fetching.
		if (app.activeRepo?.id !== repoId) return;
		if (summary.trim() || description.trim()) return;
		const parsed = parseChangesetMessage(diff.newContents);
		if (!parsed) return;
		summary = parsed.summary;
		description = parsed.description;
		detectedChangeset = {
			path: filePath,
			summary: parsed.summary,
			description: parsed.description
		};
		persistDraft();
	}

	// Drop the changeset provenance the instant the message diverges from what we
	// auto-filled — so editing makes the "detected" badge disappear and protects
	// the user's text from the removal-clear above.
	$effect(() => {
		const d = detectedChangeset;
		if (!d) return;
		if (summary !== d.summary || description !== d.description) {
			detectedChangeset = null;
		}
	});

	// Debounce persistence so we're not writing the store on every keystroke.
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function persistDraft(): void {
		const repoId = app.activeRepo?.id;
		if (!repoId) return;
		clearTimeout(saveTimer);
		// Never persist an untouched auto-filled message. While the box still matches
		// exactly what we wrote from a changeset (provenance intact), the message is
		// re-derived live from the working tree each session — persisting it would
		// resurrect it even after the changeset is committed. Checked explicitly (not
		// just `detectedChangeset != null`) because oninput fires before the divergence
		// effect runs, so an edit could otherwise look auto-filled for one tick.
		const autoFilled =
			detectedChangeset !== null &&
			summary === detectedChangeset.summary &&
			description === detectedChangeset.description;
		const snapshot = autoFilled ? { summary: '', description: '' } : { summary, description };
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
	const includedFiles = $derived(
		app.changedFiles.filter((f) => !app.excludedFromCommit.has(f.path))
	);
	const fileCount = $derived(includedFiles.length);
	const branch = $derived(app.currentBranch ?? 'detached HEAD');

	// GitHub Desktop parity: for a single-file change, suggest a commit message
	// ("Create/Update/Delete <file>") so the user can commit without typing one.
	// It shows as the Summary placeholder and is used verbatim when Summary is left
	// blank. Empty for multi-file changes — there's no sensible one-liner there.
	const suggestedSummary = $derived.by(() => {
		if (includedFiles.length !== 1) return '';
		const file = includedFiles[0];
		const name = file.path.split('/').pop() || file.path;
		const verb =
			file.status === 'added' || file.status === 'untracked'
				? 'Create'
				: file.status === 'deleted'
					? 'Delete'
					: 'Update';
		return `${verb} ${name}`;
	});

	// What the commit actually uses: the typed Summary, or the suggestion when the
	// user left Summary blank.
	const effectiveSummary = $derived(summary.trim() || suggestedSummary);
	const canCommit = $derived(!busy && fileCount > 0 && effectiveSummary.length > 0);

	// No write access to origin — committing/pushing has to go through a fork
	// first (GitHub Desktop parity). false only on a definitive "no" from the API.
	const needsFork = $derived(app.repoPushAccess === false);

	async function submit(e?: Event): Promise<void> {
		e?.preventDefault();
		if (!canCommit) return;
		// Falls back to the suggested message when Summary was left blank.
		const finalSummary = effectiveSummary;
		// Can't push to this repo — ask to fork first; the message rides along and
		// the commit runs once the fork exists (see actions.confirmFork).
		if (needsFork) {
			actions.promptFork('commit', { summary: finalSummary, description });
			return;
		}
		const repoId = app.activeRepo?.id;
		const ok = await actions.commit(finalSummary, description);
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

	// That account's token stopped authenticating (revoked, or a SAML org
	// session lapsed) — every GitHub feature is silently degraded until the user
	// re-signs in, so prompt for it where they'd otherwise see odd behavior.
	const authError = $derived(effectiveAccountAuthError());

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

<form
	class="flex flex-col gap-1.5 border-t border-border bg-card/75 p-2 backdrop-blur-md"
	onsubmit={submit}
>
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
			placeholder={suggestedSummary || 'Summary (required)'}
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

	{#if authError}
		<div
			class="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-muted-foreground"
		>
			<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" />
			<span>
				{#if authError.reason === 'sso'}
					<span class="font-medium text-foreground">{authError.login}</span>'s organization access
					needs to be re-authorized.
				{:else if authError.reason === 'scope'}
					Sign in again to let Super Review verify <span class="font-medium text-foreground"
						>{authError.login}</span
					>'s signed commits on GitHub.
				{:else}
					GitHub sign-in for <span class="font-medium text-foreground">{authError.login}</span> has expired
					or been revoked.
				{/if}
				<button
					type="button"
					class="font-medium text-foreground underline underline-offset-2 hover:text-primary"
					onclick={() => actions.openGithubSignIn()}>Sign in again</button
				>
			</span>
		</div>
	{:else if needsFork}
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
	<div
		class="flex items-center gap-2 border-t border-border bg-card/75 px-2 py-1.5 backdrop-blur-md"
	>
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
