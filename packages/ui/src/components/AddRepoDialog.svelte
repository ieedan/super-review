<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import BookMarked from '@lucide/svelte/icons/book-marked';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Download from '@lucide/svelte/icons/download';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import FolderSearch from '@lucide/svelte/icons/folder-search';
	import GitFork from '@lucide/svelte/icons/git-fork';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import OctagonAlert from '@lucide/svelte/icons/octagon-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import User from '@lucide/svelte/icons/user';
	import type {
		ClonePathState,
		GithubOrg,
		RemoteRepoRef,
		RemoteRepoSummary
	} from '@super-review/core/types';
	import * as Dialog from './ui/dialog';
	import * as Command from './ui/command';
	import * as UnderlineTabs from './ui/underline-tabs';
	import { Select } from './ui/select';
	import * as Avatar from './ui/avatar';
	import AccountSwitcher from './AccountSwitcher.svelte';
	import { Button } from './ui/button';
	import { Input } from './ui/input';
	import { Checkbox } from './ui/checkbox';
	import { actions, app } from '@super-review/ui/store.svelte';
	import { cn, formatRelative } from '@super-review/ui/utils';

	type Mode = 'choose' | 'clone' | 'create';
	// The clone flow mirrors GitHub Desktop: pick one of your own repositories by
	// default, or paste a URL. No Enterprise tab — we only speak github.com.
	type CloneTab = 'github' | 'url';

	let mode = $state<Mode>('choose');
	let busy = $state(false);

	// Clone form state.
	let cloneTab = $state<CloneTab>('github');
	let cloneUrl = $state('');
	let clonePath = $state('');
	// GitHub account whose repositories are listed (and which the clone
	// authenticates as). null means "use the app default", as elsewhere.
	let cloneAccountId = $state<string | null>(null);
	let repoFilter = $state('');
	let repos = $state<RemoteRepoSummary[]>([]);
	let reposLoading = $state(false);
	let reposError = $state<string | null>(null);
	let selectedRepo = $state<RemoteRepoSummary | null>(null);
	let reposToken = 0;
	// What's already sitting at the destination. A folder with anything in it is
	// one git refuses to clone into, and the app's own repo list can't tell us —
	// a repo cloned by another tool (or another build of this app) is invisible
	// to it, so we ask the filesystem.
	let clonePathState = $state<ClonePathState | null>(null);
	let clonePathToken = 0;
	let repoFilterInput = $state<HTMLInputElement | null>(null);
	let cloneUrlInput = $state<HTMLInputElement | null>(null);

	// Create-repo form state.
	let createName = $state('');
	let createDescription = $state('');
	let createPath = $state('');
	let initReadme = $state(true);
	let gitignore = $state<string | null>(null);
	let license = $state<string | null>(null);
	let gitignoreOptions = $state<string[]>([]);
	let licenseOptions = $state<string[]>([]);
	let defaultPath = $state('');
	let defaultsLoaded = $state(false);
	// Whether the directory we'd create into (<localPath>/<name>) is already a git
	// repo — creating there would fail, so we offer to add it directly instead.
	let pathIsRepo = $state(false);
	let pathCheckToken = 0;

	// GitHub account the new repo is pinned to. null means "use the app default"
	// (unpinned), mirroring how a project pins its account elsewhere.
	let createAccountId = $state<string | null>(null);
	const selectedAccount = $derived(
		(createAccountId ? app.githubAccounts.find((a) => a.id === createAccountId) : null) ??
			app.activeGithubAccount ??
			null
	);
	const isAccountPinned = $derived(createAccountId != null);

	// Owner the repo would live under on GitHub: an org login, or null for the
	// account's personal namespace. Drives the "<owner>/" prefix and the collision
	// check. Orgs are the selected account's, reloaded when the account changes.
	let ownerOrg = $state<string | null>(null);
	let orgs = $state<GithubOrg[]>([]);
	let orgsToken = 0;
	const owner = $derived(ownerOrg ?? selectedAccount?.login ?? null);
	const ownerAvatarUrl = $derived(
		ownerOrg
			? orgs.find((o) => o.login === ownerOrg)?.avatarUrl
			: (selectedAccount?.avatarUrl ?? undefined)
	);
	const ownerItems = $derived([
		...(selectedAccount
			? [
					{
						value: selectedAccount.login,
						label: selectedAccount.login,
						avatarUrl: selectedAccount.avatarUrl
					}
				]
			: []),
		...orgs.map((o) => ({ value: o.login, label: o.login, avatarUrl: o.avatarUrl }))
	]);
	const gitignoreItems = $derived([
		{ value: '', label: 'None' },
		...gitignoreOptions.map((o) => ({ value: o, label: o }))
	]);
	const licenseItems = $derived([
		{ value: '', label: 'None' },
		...licenseOptions.map((o) => ({ value: o, label: o }))
	]);

	// The existing remote repo (if any) whose name collides with the one being
	// typed under the selected owner. Blocks creation until name/owner change.
	let remoteRepo = $state<RemoteRepoRef | null>(null);
	let remoteCheckToken = 0;

	// The directory the repo would actually be created in: <localPath>/<name>.
	// Null until both are filled. Joined by hand (no node `path` in the renderer);
	// the picker and default both yield native separators, so we reuse whichever
	// the path already uses.
	const targetPath = $derived.by(() => {
		const dir = createPath.trim().replace(/[/\\]+$/, '');
		const name = createName.trim();
		if (!dir || !name) return null;
		const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
		return `${dir}${sep}${name}`;
	});

	const cloneAccount = $derived(
		(cloneAccountId ? app.githubAccounts.find((a) => a.id === cloneAccountId) : null) ??
			app.activeGithubAccount ??
			null
	);
	const isCloneAccountPinned = $derived(cloneAccountId != null);

	// Filter on "owner/name" so typing either half narrows the list.
	const filteredRepos = $derived.by(() => {
		const q = repoFilter.trim().toLowerCase();
		if (!q) return repos;
		return repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q));
	});

	// The account's own repos first, then one group per other owner (orgs and
	// repos shared with the account), alphabetically. Mirrors how GitHub Desktop
	// splits "Your Repositories" from the rest.
	const repoGroups = $derived.by(() => {
		const login = cloneAccount?.login?.toLowerCase();
		const mine: RemoteRepoSummary[] = [];
		const others: Record<string, RemoteRepoSummary[]> = {};
		for (const repo of filteredRepos) {
			if (login && repo.owner.toLowerCase() === login) {
				mine.push(repo);
				continue;
			}
			(others[repo.owner] ??= []).push(repo);
		}
		const groups: { label: string; avatarUrl?: string; repos: RemoteRepoSummary[] }[] = [];
		if (mine.length > 0) {
			groups.push({
				label: 'Your repositories',
				avatarUrl: cloneAccount?.avatarUrl,
				repos: mine
			});
		}
		for (const owner of Object.keys(others).sort((a, b) => a.localeCompare(b))) {
			const ownerRepos = others[owner];
			groups.push({ label: owner, avatarUrl: ownerRepos[0].ownerAvatarUrl, repos: ownerRepos });
		}
		return groups;
	});

	// The GitHub repos already cloned on this machine, keyed "owner/name" in
	// lower case. Read straight off the registered projects — no extra lookup —
	// so the picker can mark a repo you already have.
	const localRepoKeys = $derived.by(() => {
		const keys: Record<string, true> = {};
		for (const repo of app.repos) {
			if (!repo.githubOwner || !repo.githubRepo) continue;
			keys[`${repo.githubOwner.toLowerCase()}/${repo.githubRepo.toLowerCase()}`] = true;
		}
		return keys;
	});

	function isCloned(repo: RemoteRepoSummary): boolean {
		return localRepoKeys[`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`] === true;
	}

	// The URL that would actually be cloned: the picked repo on the GitHub tab,
	// whatever was pasted on the URL tab.
	const cloneSource = $derived(
		cloneTab === 'github' ? (selectedRepo?.cloneUrl.trim() ?? '') : cloneUrl.trim()
	);

	// Where the clone lands: `<clonePath>/<repo name>`, matching what the main
	// process derives from the URL. Joined by hand for the same reason as
	// targetPath below (no node `path` in the renderer).
	const cloneTarget = $derived.by(() => {
		const dir = clonePath.trim().replace(/[/\\]+$/, '');
		const name = cloneTab === 'github' ? selectedRepo?.name : repoNameFromUrl(cloneUrl);
		if (!dir || !name) return null;
		const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
		return `${dir}${sep}${name}`;
	});

	// One run of an "owner/name" row label: `dim` covers the owner prefix, `match`
	// the part the filter hit. Runs are cut at both the slash and every match edge,
	// so a query spanning the slash still highlights on both sides of it.
	interface LabelRun {
		text: string;
		dim: boolean;
		match: boolean;
	}

	function labelRuns(repo: RemoteRepoSummary, query: string): LabelRun[] {
		const label = `${repo.owner}/${repo.name}`;
		const nameStart = repo.owner.length + 1;
		const needle = query.trim().toLowerCase();
		const cuts = [0, nameStart, label.length];
		const hits: number[] = [];
		if (needle) {
			const haystack = label.toLowerCase();
			for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
				hits.push(i);
				cuts.push(i, i + needle.length);
			}
		}
		// Duplicate cuts just produce empty runs, which the loop below skips.
		const edges = cuts.sort((a, b) => a - b);
		const runs: LabelRun[] = [];
		for (let i = 0; i < edges.length - 1; i++) {
			const start = edges[i];
			const end = edges[i + 1];
			if (start === end) continue;
			runs.push({
				text: label.slice(start, end),
				dim: end <= nameStart,
				match: hits.some((hit) => start >= hit && end <= hit + needle.length)
			});
		}
		return runs;
	}

	// Muted yellow, the same band find-in-changes and the settings search paint
	// their matches with (see app.css) — one highlight colour across the app.
	function runClass(run: LabelRun): string {
		return cn(
			run.dim && 'text-muted-foreground',
			run.match && 'rounded-[2px] bg-[rgba(250,204,21,0.35)] text-foreground'
		);
	}

	// Set once we know the destination is unusable. Blocks the clone and explains
	// why; null while it's fine (or while we haven't looked yet).
	const cloneBlocked = $derived(
		clonePathState && !clonePathState.empty
			? clonePathState.isGitRepo
				? 'A repository is already cloned here.'
				: 'This folder contains files. Git can only clone to empty folders.'
			: null
	);

	// Check the destination whenever it changes. Debounced because the local path
	// is a text field — every keystroke would otherwise hit the disk — and token
	// guarded so a slow answer for an old path can't overwrite the current one.
	$effect(() => {
		const target = cloneTarget;
		clonePathState = null;
		if (mode !== 'clone' || !target) return;
		const token = ++clonePathToken;
		const timer = setTimeout(() => {
			void window.api.repos
				.inspectClonePath(target)
				.then((state) => {
					if (token === clonePathToken) clonePathState = state;
				})
				.catch(() => {});
		}, 250);
		return () => clearTimeout(timer);
	});

	// Repo folder name git would pick for a URL — same rule as core's cloneRepo.
	function repoNameFromUrl(url: string): string | null {
		const trimmed = url.trim().replace(/\.git$/, '');
		if (!trimmed) return null;
		return trimmed.split(/[/:]/).pop() || null;
	}

	// Load an account's repositories into the picker. Token guarded so a slow
	// response for a previously selected account can't overwrite the current one.
	// The main process caches per account, so a warm listing lands in the same
	// tick and the spinner never actually paints; `force` re-fetches.
	async function loadRepos(accountId: string, force: boolean): Promise<void> {
		const token = ++reposToken;
		reposError = null;
		reposLoading = true;
		try {
			const list = await window.api.github.listAccountRepositories(accountId, force);
			if (token === reposToken) repos = list;
		} catch (err) {
			if (token === reposToken) reposError = err instanceof Error ? err.message : String(err);
		} finally {
			if (token === reposToken) reposLoading = false;
		}
	}

	$effect(() => {
		const accountId = cloneAccount?.id;
		if (mode !== 'clone' || cloneTab !== 'github' || !accountId) return;
		repos = [];
		selectedRepo = null;
		void loadRepos(accountId, false);
	});

	// Warm the listing the moment the dialog opens, rather than when the clone
	// tab mounts: the seconds spent reading the four options are seconds the
	// fetch can be running in. The main process de-duplicates in-flight requests,
	// so the picker's own load costs nothing on top of this.
	$effect(() => {
		if (!app.addRepoDialogOpen) return;
		const accountId = app.activeGithubAccount?.id;
		if (!accountId) return;
		void window.api.github.listAccountRepositories(accountId).catch(() => {});
	});

	// A stale cache is served immediately and revalidated behind us; when that
	// lands, swap the fresh list in. Selection survives because rows are matched
	// by owner/name rather than object identity.
	$effect(() => {
		if (mode !== 'clone') return;
		return window.api.events.onGithubReposUpdated(({ accountId, repos: fresh }) => {
			if (accountId === cloneAccount?.id) repos = fresh;
		});
	});

	// Put the caret in whichever field the active clone tab leads with. Both
	// inputs mount with their tab body, so this runs as they appear — including
	// on the switch between tabs.
	$effect(() => {
		if (mode !== 'clone') return;
		const el = cloneTab === 'url' ? cloneUrlInput : repoFilterInput;
		el?.focus();
	});

	// Reset whenever the dialog is closed so reopening starts fresh.
	$effect(() => {
		if (!app.addRepoDialogOpen) {
			mode = 'choose';
			cloneTab = 'github';
			cloneUrl = '';
			clonePath = '';
			cloneAccountId = null;
			repoFilter = '';
			clonePathState = null;
			repos = [];
			reposError = null;
			reposLoading = false;
			selectedRepo = null;
			busy = false;
			createName = '';
			createDescription = '';
			createPath = '';
			initReadme = true;
			gitignore = null;
			license = null;
			pathIsRepo = false;
			createAccountId = null;
			ownerOrg = null;
			orgs = [];
			remoteRepo = null;
		}
	});

	// Load the selected account's orgs so they can be picked as the owner. Reset
	// the chosen org whenever the account changes, since orgs are account-scoped.
	$effect(() => {
		const accountId = selectedAccount?.id;
		ownerOrg = null;
		orgs = [];
		if (mode !== 'create' || !accountId) return;
		const token = ++orgsToken;
		void window.api.github
			.listAccountOrganizations(accountId)
			.then((list) => {
				if (token === orgsToken) orgs = list;
			})
			.catch(() => {});
	});

	// Flag when a repo with this name already exists under the selected owner (we
	// can't publish over it later), so block creation and point the user at the
	// existing repo. Debounced (network per keystroke) and token guarded so a slow
	// check for an old name/owner can't win a race.
	$effect(() => {
		const name = createName.trim();
		const accountId = selectedAccount?.id;
		const ns = owner ?? undefined;
		remoteRepo = null;
		if (mode !== 'create' || !name || !accountId) return;
		const token = ++remoteCheckToken;
		const timer = setTimeout(() => {
			void window.api.repos
				.checkRemoteRepo(name, accountId, ns)
				.then((ref) => {
					if (token === remoteCheckToken) remoteRepo = ref;
				})
				.catch(() => {});
		}, 400);
		return () => clearTimeout(timer);
	});

	// Flag when the target directory is already a repo. Guarded by a token so a
	// slow check for an old target can't overwrite the result for the current one.
	$effect(() => {
		const target = targetPath;
		if (mode !== 'create' || !target) {
			pathIsRepo = false;
			return;
		}
		const token = ++pathCheckToken;
		void window.api.repos
			.isGitRepo(target)
			.then((is) => {
				if (token === pathCheckToken) pathIsRepo = is;
			})
			.catch(() => {});
	});

	async function openExisting(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await actions.openRepo();
			actions.closeAddRepoDialog();
		} finally {
			busy = false;
		}
	}

	async function openFolder(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await actions.openFolder();
			actions.closeAddRepoDialog();
		} finally {
			busy = false;
		}
	}

	// Suggested parent directory and template labels, shared by the clone and
	// create forms. Fetched once per session.
	async function loadDefaults(): Promise<void> {
		if (defaultsLoaded) return;
		try {
			const defaults = await window.api.repos.getCreateDefaults();
			gitignoreOptions = defaults.gitignores;
			licenseOptions = defaults.licenses;
			defaultPath = defaults.defaultPath;
		} catch {
			// Templates just stay empty (only "None" available); not fatal.
		}
		defaultsLoaded = true;
	}

	async function enterCreate(): Promise<void> {
		mode = 'create';
		await loadDefaults();
		if (!createPath) createPath = defaultPath;
	}

	async function enterClone(): Promise<void> {
		mode = 'clone';
		// Nothing to pick from without an account — start on the URL tab instead.
		cloneTab = app.githubAccounts.length > 0 ? 'github' : 'url';
		await loadDefaults();
		if (!clonePath) clonePath = defaultPath;
	}

	async function chooseClonePath(): Promise<void> {
		const dir = await window.api.repos.chooseDirectory();
		if (dir) clonePath = dir;
	}

	async function choosePath(): Promise<void> {
		const dir = await window.api.repos.chooseDirectory();
		if (dir) createPath = dir;
	}

	async function submitCreate(e?: Event): Promise<void> {
		e?.preventDefault();
		if (busy || !createName.trim() || !createPath.trim() || remoteRepo) return;
		busy = true;
		try {
			const ok = await actions.createRepo({
				path: createPath.trim(),
				name: createName.trim(),
				description: createDescription.trim() || undefined,
				initReadme,
				gitignore,
				license,
				accountId: createAccountId,
				owner: ownerOrg ?? undefined
			});
			if (ok) actions.closeAddRepoDialog();
		} finally {
			busy = false;
		}
	}

	async function addExisting(): Promise<void> {
		if (busy || !targetPath) return;
		busy = true;
		try {
			const ok = await actions.addExistingRepo(targetPath);
			if (ok) actions.closeAddRepoDialog();
		} finally {
			busy = false;
		}
	}

	// The destination is already a repo — register that one rather than cloning a
	// second copy somewhere else. Mirrors the create form's same-named shortcut.
	async function addExistingClone(): Promise<void> {
		if (busy || !cloneTarget) return;
		busy = true;
		try {
			const ok = await actions.addExistingRepo(cloneTarget);
			if (ok) actions.closeAddRepoDialog();
		} finally {
			busy = false;
		}
	}

	async function submitClone(e?: Event): Promise<void> {
		e?.preventDefault();
		const parentDir = clonePath.trim();
		if (busy || !cloneSource || !parentDir || cloneBlocked) return;
		busy = true;
		try {
			const ok = await actions.cloneRepo(cloneSource, {
				parentDir,
				// Pin the clone to the account it was picked from so private repos
				// keep authenticating as it. A pasted URL stays on the app default.
				accountId: cloneTab === 'github' ? (cloneAccount?.id ?? null) : null
			});
			if (ok) actions.closeAddRepoDialog();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root
	open={app.addRepoDialogOpen}
	onOpenChange={(v) => (v ? actions.openAddRepoDialog() : actions.closeAddRepoDialog())}
>
	<Dialog.Content class="overflow-hidden {mode === 'choose' ? 'sm:max-w-md' : 'sm:max-w-lg'}">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				{#if mode === 'clone'}
					<Download class="size-4" /> Clone a repository
				{:else if mode === 'create'}
					<Plus class="size-4" /> Create a new repository
				{:else}
					Add repository
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if mode === 'clone'}
					Pick one of your GitHub repositories, or paste a Git URL.
				{:else if mode === 'create'}
					Scaffold a new repository with an optional README, .gitignore, and license.
				{:else}
					Open a repo, scan a folder for repos, clone one from GitHub, or create a new one.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if mode === 'choose'}
			<div class="grid gap-2">
				<button
					type="button"
					class="flex items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
					onclick={openExisting}
					disabled={busy}
				>
					<FolderOpen class="mt-0.5 size-4 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium">Open existing repository</div>
						<div class="text-xs text-muted-foreground">
							Pick a folder that's already a git repo.
						</div>
					</div>
				</button>
				<button
					type="button"
					class="flex items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
					onclick={openFolder}
					disabled={busy}
				>
					<FolderSearch class="mt-0.5 size-4 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium">Open a folder</div>
						<div class="text-xs text-muted-foreground">
							Scan a folder and add every git repo inside it.
						</div>
					</div>
				</button>
				<button
					type="button"
					class="flex items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
					onclick={enterClone}
					disabled={busy}
				>
					<Download class="mt-0.5 size-4 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium">Clone a repository</div>
						<div class="text-xs text-muted-foreground">
							Pick one of your GitHub repositories, or clone from a URL.
						</div>
					</div>
				</button>
				<button
					type="button"
					class="flex items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
					onclick={enterCreate}
					disabled={busy}
				>
					<Plus class="mt-0.5 size-4 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium">Create new repository</div>
						<div class="text-xs text-muted-foreground">
							Create a fresh repo with a README, .gitignore, and license.
						</div>
					</div>
				</button>
			</div>
			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => actions.closeAddRepoDialog()}
				>
					Cancel
				</Button>
			</Dialog.Footer>
		{:else if mode === 'create'}
			<form class="grid gap-4" onsubmit={submitCreate}>
				{#if app.githubAccounts.length > 0}
					<div class="grid grid-cols-2 gap-3">
						<div class="grid gap-1.5">
							<!-- svelte-ignore a11y_label_has_associated_control -->
							<label class="text-sm font-medium">Account</label>
							<AccountSwitcher
								align="start"
								heading="Account for this repository"
								selectedAccountId={selectedAccount?.id}
								defaultAccountId={app.activeGithubAccount?.id}
								isPinned={isAccountPinned}
								showSettings={false}
								onSelectAccount={(id) => (createAccountId = id)}
								onUseDefault={() => (createAccountId = null)}
								triggerClass="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
							>
								{#snippet trigger()}
									<Avatar.Root class="size-5 shrink-0">
										{#if selectedAccount?.avatarUrl}
											<Avatar.Image src={selectedAccount.avatarUrl} alt={selectedAccount.login} />
										{/if}
										<Avatar.Fallback class="text-[9px]">
											{#if selectedAccount}
												{selectedAccount.login.slice(0, 2).toUpperCase()}
											{:else}
												<User class="size-3" />
											{/if}
										</Avatar.Fallback>
									</Avatar.Root>
									<span class="min-w-0 flex-1 truncate">
										{selectedAccount?.login ?? 'Select an account'}
									</span>
									<ChevronDown class="size-4 shrink-0 text-muted-foreground" />
								{/snippet}
							</AccountSwitcher>
						</div>

						<div class="grid gap-1.5">
							<!-- svelte-ignore a11y_label_has_associated_control -->
							<label class="text-sm font-medium">Owner</label>
							<Select
								type="single"
								value={owner ?? ''}
								onValueChange={(v) => (ownerOrg = v === selectedAccount?.login ? null : v)}
								items={ownerItems}
								placeholder="Select an owner"
								disabled={busy || orgs.length === 0}
								title={orgs.length === 0
									? 'This account has no organizations to publish under'
									: 'Choose the owner for this repository'}
							>
								{#snippet item({ item })}
									<Avatar.Root class="size-5 shrink-0">
										{#if item.avatarUrl}
											<Avatar.Image src={item.avatarUrl} alt={item.label} />
										{/if}
										<Avatar.Fallback class="text-[9px]">
											{item.label.slice(0, 2).toUpperCase()}
										</Avatar.Fallback>
									</Avatar.Root>
									{item.label}
								{/snippet}
							</Select>
						</div>
					</div>
				{/if}

				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">Name</label>
					<div
						class="flex h-8 w-full items-center overflow-hidden rounded-lg border border-input bg-transparent text-sm outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
						class:opacity-50={busy}
					>
						{#if owner}
							<span
								class="flex h-full shrink-0 items-center gap-1.5 border-r border-input bg-muted/50 px-2.5 text-muted-foreground dark:bg-input/50"
							>
								<Avatar.Root class="size-4 shrink-0">
									{#if ownerAvatarUrl}
										<Avatar.Image src={ownerAvatarUrl} alt={owner} />
									{/if}
									<Avatar.Fallback class="text-[8px]">
										{owner.slice(0, 2).toUpperCase()}
									</Avatar.Fallback>
								</Avatar.Root>
								{owner}/
							</span>
						{/if}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="text"
							bind:value={createName}
							placeholder="repository name"
							disabled={busy}
							autofocus
							class="h-full w-full min-w-0 bg-transparent px-2.5 py-1 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
						/>
					</div>
					{#if remoteRepo}
						<p class="text-xs text-destructive">
							A repository named <span class="font-medium">{remoteRepo.name}</span> already exists
							on
							{remoteRepo.owner}. Pick a different name, account, or organization, or
							<button
								type="button"
								class="underline underline-offset-2 hover:no-underline disabled:opacity-50"
								disabled={busy}
								onclick={() => void window.api.shell.openExternal(remoteRepo!.htmlUrl)}
								>view the existing repository</button
							>.
						</p>
					{/if}
				</div>

				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">Description</label>
					<Input type="text" bind:value={createDescription} disabled={busy} />
				</div>

				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">Local path</label>
					<div class="flex gap-2">
						<Input type="text" bind:value={createPath} class="font-mono text-xs" disabled={busy} />
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="shrink-0"
							disabled={busy}
							onclick={choosePath}
						>
							Choose…
						</Button>
					</div>
					{#if pathIsRepo}
						<p class="text-xs text-destructive">
							This directory is already a Git repository. Would you like to
							<button
								type="button"
								class="underline underline-offset-2 hover:no-underline disabled:opacity-50"
								disabled={busy}
								onclick={addExisting}>add this repository</button
							> instead?
						</p>
					{/if}
				</div>

				<label class="flex items-center gap-2 text-sm">
					<Checkbox bind:checked={initReadme} disabled={busy} />
					Initialize this repository with a README
				</label>

				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">Git ignore</label>
					<Select
						type="single"
						value={gitignore ?? ''}
						onValueChange={(v) => (gitignore = v === '' ? null : v)}
						items={gitignoreItems}
						placeholder="None"
						disabled={busy}
					/>
				</div>

				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">License</label>
					<Select
						type="single"
						value={license ?? ''}
						onValueChange={(v) => (license = v === '' ? null : v)}
						items={licenseItems}
						placeholder="None"
						disabled={busy}
					/>
				</div>

				<Dialog.Footer>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => (mode = 'choose')}
					>
						<ChevronLeft class="size-3.5" /> Back
					</Button>
					<Button
						type="submit"
						size="sm"
						disabled={busy || !createName.trim() || !createPath.trim() || !!remoteRepo}
					>
						{#if busy}
							<Loader2 class="size-3.5 animate-spin" /> Creating…
						{:else}
							Create repository
						{/if}
					</Button>
				</Dialog.Footer>
			</form>
		{:else}
			<form class="grid gap-4" onsubmit={submitClone}>
				<UnderlineTabs.Root
					value={cloneTab}
					onValueChange={(v) => (cloneTab = v as CloneTab)}
					class="gap-3"
				>
					<UnderlineTabs.List>
						<UnderlineTabs.Trigger value="github" class="text-sm">GitHub</UnderlineTabs.Trigger>
						<UnderlineTabs.Trigger value="url" class="text-sm">URL</UnderlineTabs.Trigger>
					</UnderlineTabs.List>

					<!-- Both tab bodies live in a region of fixed height, so neither
					     filtering the list down to one row nor switching to the URL tab
					     resizes the dialog under the pointer. Render only the active tab's
					     body rather than bits-ui's hidden Tabs.Content panels: the repo
					     list lives in a Command root whose keyboard selection would
					     otherwise keep running while hidden. -->
					<div class="h-[19rem]">
						{#if cloneTab === 'github'}
							{#if app.githubAccounts.length === 0}
								<div
									class="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-border p-8"
								>
									<p class="text-center text-sm text-muted-foreground">
										Sign in to GitHub to clone one of your repositories.
									</p>
									<Button type="button" size="sm" onclick={() => actions.openGithubSignIn()}>
										Sign in to GitHub
									</Button>
								</div>
							{:else}
								<Command.Root shouldFilter={false} class="h-full rounded-md border border-border">
									<!-- Sticky header: whose repositories to list, a filter, and a
								     refresh for repos created since the list was fetched. -->
									<div class="flex items-center gap-2 border-b border-border p-2">
										<AccountSwitcher
											align="start"
											heading="Clone from account"
											selectedAccountId={cloneAccount?.id}
											defaultAccountId={app.activeGithubAccount?.id}
											isPinned={isCloneAccountPinned}
											showSettings={false}
											onSelectAccount={(id) => (cloneAccountId = id)}
											onUseDefault={() => (cloneAccountId = null)}
											triggerClass="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-transparent px-2 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
										>
											{#snippet trigger()}
												<Avatar.Root class="size-5 shrink-0">
													{#if cloneAccount?.avatarUrl}
														<Avatar.Image src={cloneAccount.avatarUrl} alt={cloneAccount.login} />
													{/if}
													<Avatar.Fallback class="text-[9px]">
														{#if cloneAccount}
															{cloneAccount.login.slice(0, 2).toUpperCase()}
														{:else}
															<User class="size-3" />
														{/if}
													</Avatar.Fallback>
												</Avatar.Root>
												<span class="max-w-[9rem] truncate">
													{cloneAccount?.login ?? 'Select an account'}
												</span>
												<ChevronDown class="size-4 shrink-0 text-muted-foreground" />
											{/snippet}
										</AccountSwitcher>
										<div
											class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2"
										>
											<Search class="size-3.5 shrink-0 text-muted-foreground" />
											<CommandPrimitive.Input
												bind:ref={repoFilterInput}
												bind:value={repoFilter}
												placeholder="Filter your repositories…"
												class="flex h-full w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
											/>
										</div>
										<Button
											type="button"
											variant="outline"
											size="sm"
											class="size-8 shrink-0 p-0"
											title="Refresh repositories"
											disabled={reposLoading || !cloneAccount}
											onclick={() => cloneAccount && void loadRepos(cloneAccount.id, true)}
										>
											<RefreshCw class={cn('size-3.5', reposLoading && 'animate-spin')} />
										</Button>
									</div>

									<Command.List class="max-h-none min-h-0 flex-1">
										{#if reposLoading}
											<div
												class="flex h-full items-center justify-center gap-2 px-3 text-xs text-muted-foreground"
											>
												<Loader2 class="size-3.5 animate-spin" /> Loading repositories…
											</div>
										{:else if reposError}
											<div
												class="flex h-full items-center justify-center px-3 text-center text-xs text-destructive"
											>
												{reposError}
											</div>
										{:else if repos.length === 0}
											<div
												class="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground"
											>
												This account has no repositories.
											</div>
										{:else if filteredRepos.length === 0}
											<div
												class="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground"
											>
												No matches
											</div>
										{:else}
											{#each repoGroups as group (group.label)}
												<Command.Group class="p-1">
													<div
														class="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground"
													>
														{#if group.avatarUrl}
															<Avatar.Root class="size-4 shrink-0">
																<Avatar.Image src={group.avatarUrl} alt={group.label} />
																<Avatar.Fallback class="text-[8px]">
																	{group.label.slice(0, 2).toUpperCase()}
																</Avatar.Fallback>
															</Avatar.Root>
														{/if}
														{group.label}
													</div>
													<!-- Rows render straight into the list (no virtualization) so
												     the filter input's arrow keys can move through them and
												     scroll the highlighted row into view. -->
													{#each group.repos as repo (`${repo.owner}/${repo.name}`)}
														{@const isSelected =
															selectedRepo?.owner === repo.owner &&
															selectedRepo?.name === repo.name}
														<Command.Item
															value={`${repo.owner}/${repo.name}`}
															onSelect={() => (selectedRepo = repo)}
															class={cn(
																'flex items-center gap-2 [contain-intrinsic-size:auto_28px] [content-visibility:auto]',
																isSelected && 'bg-accent/60'
															)}
														>
															{#if repo.fork}
																<GitFork
																	class="size-3.5 shrink-0 text-muted-foreground"
																	aria-label="Fork"
																/>
															{:else}
																<BookMarked class="size-3.5 shrink-0 text-muted-foreground" />
															{/if}
															<!-- Owner prefix stays dim so the repo name still reads as the
														     row's subject, but a filtered list (where the group headings
														     scroll away) never leaves you guessing whose repo it is. The
														     runs are laid out without whitespace between them: any newline
														     here would render as a space inside the label. -->
															<!-- prettier-ignore -->
															<span class={cn('min-w-0 flex-1 truncate', isSelected && 'font-medium')}
														>{#each labelRuns(repo, repoFilter) as run, i (i)}<span class={runClass(run)}>{run.text}</span>{/each}</span>
															{#if repo.private}
																<Lock
																	class="size-3 shrink-0 text-muted-foreground"
																	aria-label="Private"
																/>
															{/if}
															{#if isCloned(repo)}
																<span
																	class="shrink-0 rounded bg-foreground/10 px-1 py-0.5 text-[10px] leading-none font-medium text-muted-foreground"
																	title="Already cloned on this machine"
																>
																	local
																</span>
															{/if}
															{#if repo.archived}
																<span
																	class="shrink-0 rounded bg-foreground/10 px-1 py-0.5 text-[10px] leading-none font-medium text-muted-foreground"
																>
																	archived
																</span>
															{/if}
															{#if repo.pushedAt}
																<span class="shrink-0 text-[10px] text-muted-foreground">
																	{formatRelative(repo.pushedAt)}
																</span>
															{/if}
														</Command.Item>
													{/each}
												</Command.Group>
											{/each}
										{/if}
									</Command.List>
								</Command.Root>
							{/if}
						{:else}
							<div class="grid gap-1.5">
								<!-- svelte-ignore a11y_label_has_associated_control -->
								<label class="text-sm font-medium">Repository URL</label>
								<Input
									type="text"
									bind:ref={cloneUrlInput}
									bind:value={cloneUrl}
									placeholder="https://github.com/owner/repo.git"
									class="font-mono text-xs"
									disabled={busy}
								/>
							</div>
						{/if}
					</div>
				</UnderlineTabs.Root>

				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">Local path</label>
					<div class="flex gap-2">
						<Input type="text" bind:value={clonePath} class="font-mono text-xs" disabled={busy} />
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="shrink-0"
							disabled={busy}
							onclick={chooseClonePath}
						>
							Choose…
						</Button>
					</div>
					{#if cloneBlocked}
						<!-- The destination is unusable, so say so where the path was typed
						     and keep the Clone button off. When what's there is already a
						     repo, adding it beats cloning a second copy of it. -->
						<div
							class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
						>
							<OctagonAlert class="mt-px size-3.5 shrink-0" />
							<div class="min-w-0">
								<p>{cloneBlocked}</p>
								<p class="truncate text-destructive/80" title={cloneTarget}>
									<span class="font-mono">{cloneTarget}</span>
								</p>
								{#if clonePathState?.isGitRepo}
									<button
										type="button"
										class="mt-1 underline underline-offset-2 hover:no-underline disabled:opacity-50"
										disabled={busy}
										onclick={addExistingClone}
									>
										Add this repository instead
									</button>
								{/if}
							</div>
						</div>
					{:else if cloneTarget}
						<p class="truncate text-xs text-muted-foreground" title={cloneTarget}>
							Clones into <span class="font-mono">{cloneTarget}</span>
						</p>
					{/if}
				</div>

				<Dialog.Footer>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => (mode = 'choose')}
					>
						<ChevronLeft class="size-3.5" /> Back
					</Button>
					<Button
						type="submit"
						size="sm"
						disabled={busy || !cloneSource || !clonePath.trim() || !!cloneBlocked}
					>
						{#if busy}
							<Loader2 class="size-3.5 animate-spin" /> Cloning…
						{:else}
							Clone
						{/if}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
