<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Github from './icons/GithubIcon.svelte';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { Input } from './ui/input';
	import { Checkbox } from './ui/checkbox';
	import { actions, app, effectiveGithubAccount } from '@super-review/ui/store.svelte';
	import type { GithubOrg } from '@super-review/core/types';

	let name = $state('');
	let description = $state('');
	// "Keep this code private" — checked by default, matching GitHub Desktop.
	let keepPrivate = $state(true);
	// Org login to publish under, or null for the signed-in user's account.
	let org = $state<string | null>(null);
	let orgs = $state<GithubOrg[]>([]);
	let busy = $state(false);

	const account = $derived(effectiveGithubAccount());
	const signedIn = $derived(app.githubAccounts.length > 0);

	// Reset the form and (re)load orgs each time the dialog opens. Seeds the name
	// and description from the local repo so the common case is one click.
	$effect(() => {
		if (!app.publishDialogOpen) return;
		name = app.activeRepo?.name ?? '';
		description = app.activeRepo?.description ?? '';
		keepPrivate = true;
		org = null;
		busy = false;
		if (!signedIn) {
			orgs = [];
			return;
		}
		void window.api.github
			.listOrganizations(app.activeRepo?.id)
			.then((list) => {
				orgs = list;
			})
			.catch(() => {
				orgs = [];
			});
	});

	async function submit(e?: Event): Promise<void> {
		e?.preventDefault();
		if (busy || !signedIn || !name.trim()) return;
		busy = true;
		try {
			const ok = await actions.publishRepo({
				name: name.trim(),
				description: description.trim() || undefined,
				private: keepPrivate,
				org
			});
			if (ok) actions.closePublishDialog();
		} finally {
			busy = false;
		}
	}

	const selectClass =
		'h-8 w-full appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';
</script>

<Dialog.Root
	open={app.publishDialogOpen}
	onOpenChange={(v) => (v ? actions.openPublishDialog() : actions.closePublishDialog())}
>
	<Dialog.Content class="overflow-hidden sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				<Github class="size-4" /> Publish Repository
			</Dialog.Title>
			<Dialog.Description>
				{#if signedIn}
					Create this repository on GitHub{account ? ` as ${account.login}` : ''} and push your current
					branch.
				{:else}
					Sign in to GitHub from the account menu (top right) to publish this repository.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-4" onsubmit={submit}>
			<div class="grid gap-1.5">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="text-sm font-medium">Name</label>
				<Input
					type="text"
					bind:value={name}
					placeholder="repository name"
					disabled={busy || !signedIn}
					autofocus
				/>
			</div>

			<div class="grid gap-1.5">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="text-sm font-medium">Description</label>
				<Input type="text" bind:value={description} disabled={busy || !signedIn} />
			</div>

			<label class="flex items-center gap-2 text-sm">
				<Checkbox bind:checked={keepPrivate} disabled={busy || !signedIn} />
				Keep this code private
			</label>

			<div class="grid gap-1.5">
				<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="text-sm font-medium">Organization</label>
				<div class="relative">
					<select bind:value={org} disabled={busy || !signedIn} class={selectClass}>
						<option value={null}>None</option>
						{#each orgs as o (o.login)}
							<option value={o.login}>{o.login}</option>
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
					onclick={() => actions.closePublishDialog()}
				>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={busy || !signedIn || !name.trim()}>
					{#if busy}
						<Loader2 class="size-3.5 animate-spin" /> Publishing…
					{:else}
						Publish Repository
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
