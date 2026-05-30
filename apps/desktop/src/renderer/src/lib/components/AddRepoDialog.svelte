<script lang="ts">
	import {
		ChevronDown,
		ChevronLeft,
		Download,
		FolderOpen,
		FolderSearch,
		Loader2,
		Plus
	} from 'lucide-svelte';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { Input } from './ui/input';
	import { Checkbox } from './ui/checkbox';
	import { actions, app } from '$lib/store.svelte';

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
		}
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
		if (busy || !createName.trim() || !createPath.trim()) return;
		busy = true;
		try {
			const ok = await actions.createRepo({
				path: createPath.trim(),
				name: createName.trim(),
				description: createDescription.trim() || undefined,
				initReadme,
				gitignore,
				license
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

	const selectClass =
		'h-8 w-full appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';
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
					Paste a Git URL — you'll pick a destination folder next.
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
				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">Name</label>
					<Input
						type="text"
						bind:value={createName}
						placeholder="repository name"
						disabled={busy}
						autofocus
					/>
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
					<div class="relative">
						<select bind:value={gitignore} disabled={busy} class={selectClass}>
							<option value={null}>None</option>
							{#each gitignoreOptions as opt (opt)}
								<option value={opt}>{opt}</option>
							{/each}
						</select>
						<ChevronDown
							class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
						/>
					</div>
				</div>

				<div class="grid gap-1.5">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="text-sm font-medium">License</label>
					<div class="relative">
						<select bind:value={license} disabled={busy} class={selectClass}>
							<option value={null}>None</option>
							{#each licenseOptions as opt (opt)}
								<option value={opt}>{opt}</option>
							{/each}
						</select>
						<ChevronDown
							class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
						/>
					</div>
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
						disabled={busy || !createName.trim() || !createPath.trim()}
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
