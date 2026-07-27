<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Download from '@lucide/svelte/icons/download';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import FolderSearch from '@lucide/svelte/icons/folder-search';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Plus from '@lucide/svelte/icons/plus';
	import User from '@lucide/svelte/icons/user';
	import type { GithubOrg, RemoteRepoRef } from '@super-review/core/types';
	import * as Dialog from './ui/dialog';
	import * as Select from './ui/select';
	import * as Avatar from './ui/avatar';
	import AccountSwitcher from './AccountSwitcher.svelte';
	import { Button } from './ui/button';
	import { Input } from './ui/input';
	import { Checkbox } from './ui/checkbox';
	import { actions, app } from '@super-review/ui/store.svelte';

	type Mode = 'choose' | 'clone' | 'create';

	let mode = $state<Mode>('choose');
	let cloneUrl = $state('');
	let busy = $state(false);

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

	// Reset whenever the dialog is closed so reopening starts fresh.
	$effect(() => {
		if (!app.addRepoDialogOpen) {
			mode = 'choose';
			cloneUrl = '';
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

	async function enterCreate(): Promise<void> {
		mode = 'create';
		if (!defaultsLoaded) {
			try {
				const defaults = await window.api.repos.getCreateDefaults();
				gitignoreOptions = defaults.gitignores;
				licenseOptions = defaults.licenses;
				defaultPath = defaults.defaultPath;
				defaultsLoaded = true;
			} catch {
				// Templates just stay empty (only "None" available); not fatal.
				defaultsLoaded = true;
			}
		}
		if (!createPath) createPath = defaultPath;
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

	async function submitClone(e?: Event): Promise<void> {
		e?.preventDefault();
		if (busy || !cloneUrl.trim()) return;
		busy = true;
		try {
			await actions.cloneRepo(cloneUrl.trim());
			actions.closeAddRepoDialog();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root
	open={app.addRepoDialogOpen}
	onOpenChange={(v) => (v ? actions.openAddRepoDialog() : actions.closeAddRepoDialog())}
>
	<Dialog.Content class="overflow-hidden {mode === 'create' ? 'sm:max-w-lg' : 'sm:max-w-md'}">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				{#if mode === 'clone'}
					<Download class="size-4" /> Clone repository
				{:else if mode === 'create'}
					<Plus class="size-4" /> Create a new repository
				{:else}
					Add repository
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if mode === 'clone'}
					Paste a Git URL. You'll pick a destination folder next.
				{:else if mode === 'create'}
					Scaffold a new repository with an optional README, .gitignore, and license.
				{:else}
					Open a repo, scan a folder for repos, clone from a URL, or create a new one.
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
					onclick={() => (mode = 'clone')}
					disabled={busy}
				>
					<Download class="mt-0.5 size-4 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium">Clone from URL</div>
						<div class="text-xs text-muted-foreground">
							Clone a remote repository into a local folder.
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
							<Select.Root
								type="single"
								value={owner ?? undefined}
								onValueChange={(v) => (ownerOrg = v === selectedAccount?.login ? null : v)}
								disabled={busy || orgs.length === 0}
							>
								<Select.Trigger
									class="w-full"
									title={orgs.length === 0
										? 'This account has no organizations to publish under'
										: 'Choose the owner for this repository'}
								>
									<Avatar.Root class="size-5 shrink-0">
										{#if ownerAvatarUrl}
											<Avatar.Image src={ownerAvatarUrl} alt={owner ?? ''} />
										{/if}
										<Avatar.Fallback class="text-[9px]">
											{owner ? owner.slice(0, 2).toUpperCase() : ''}
										</Avatar.Fallback>
									</Avatar.Root>
									<span class="min-w-0 flex-1 truncate text-left">{owner ?? 'Select an owner'}</span
									>
								</Select.Trigger>
								<Select.Content>
									{#if selectedAccount}
										<Select.Item value={selectedAccount.login} label={selectedAccount.login}>
											<Avatar.Root class="size-5 shrink-0">
												{#if selectedAccount.avatarUrl}
													<Avatar.Image
														src={selectedAccount.avatarUrl}
														alt={selectedAccount.login}
													/>
												{/if}
												<Avatar.Fallback class="text-[9px]">
													{selectedAccount.login.slice(0, 2).toUpperCase()}
												</Avatar.Fallback>
											</Avatar.Root>
											{selectedAccount.login}
										</Select.Item>
									{/if}
									{#each orgs as o (o.login)}
										<Select.Item value={o.login} label={o.login}>
											<Avatar.Root class="size-5 shrink-0">
												{#if o.avatarUrl}
													<Avatar.Image src={o.avatarUrl} alt={o.login} />
												{/if}
												<Avatar.Fallback class="text-[9px]">
													{o.login.slice(0, 2).toUpperCase()}
												</Avatar.Fallback>
											</Avatar.Root>
											{o.login}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
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
					<Select.Root
						type="single"
						value={gitignore ?? ''}
						onValueChange={(v) => (gitignore = v === '' ? null : v)}
						disabled={busy}
					>
						<Select.Trigger class="w-full">
							{gitignore ?? 'None'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="" label="None">None</Select.Item>
							{#each gitignoreOptions as opt (opt)}
								<Select.Item value={opt} label={opt}>{opt}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">License</label>
					<Select.Root
						type="single"
						value={license ?? ''}
						onValueChange={(v) => (license = v === '' ? null : v)}
						disabled={busy}
					>
						<Select.Trigger class="w-full">
							{license ?? 'None'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="" label="None">None</Select.Item>
							{#each licenseOptions as opt (opt)}
								<Select.Item value={opt} label={opt}>{opt}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
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
			<form class="grid gap-3" onsubmit={submitClone}>
				<Input
					type="text"
					bind:value={cloneUrl}
					placeholder="https://github.com/owner/repo.git"
					class="font-mono text-xs"
					disabled={busy}
					autofocus
				/>
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
					<Button type="submit" size="sm" disabled={busy || !cloneUrl.trim()}>
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
