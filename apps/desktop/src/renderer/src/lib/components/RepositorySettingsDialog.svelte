<script lang="ts">
	import { GitFork } from 'lucide-svelte';
	import { Button } from './ui/button';
	import SettingsShell from './SettingsShell.svelte';
	import ForkUseChoice from './ForkUseChoice.svelte';
	import { actions, app } from '$lib/store.svelte';

	let open = $derived(app.repoSettingsDialogOpen);
	let activeTab = $state('fork');
	const TABS = [{ id: 'fork', label: 'Fork Behavior', icon: GitFork }];

	// Parent resolved from the GitHub API when the dialog opens — needed even in
	// "own purposes" mode, where the upstream metadata is cleared. undefined =
	// still loading; null = not a fork.
	let parent = $state<{ owner: string; repo: string } | null | undefined>(undefined);
	let use = $state<'parent' | 'self'>('parent');
	let saving = $state(false);

	// (Re)load when the dialog opens for the active repo. Default the radio from
	// the current metadata (upstream present = currently contributing to parent).
	let loadedFor: string | null = null;
	$effect(() => {
		if (!open) {
			loadedFor = null;
			return;
		}
		const repo = app.activeRepo;
		if (!repo || loadedFor === repo.id) return;
		loadedFor = repo.id;
		activeTab = 'fork';
		use = repo.upstreamOwner && repo.upstreamRepo ? 'parent' : 'self';
		parent = undefined;
		void window.api.github.getRepoParent(repo.id).then((p) => {
			if (app.repoSettingsDialogOpen && app.activeRepo?.id === repo.id) parent = p;
		});
	});

	const parentLabel = $derived(parent ? `${parent.owner}/${parent.repo}` : null);
	const isFork = $derived(parent != null);

	async function save(): Promise<void> {
		saving = true;
		await actions.setForkBehavior(use === 'parent');
		saving = false;
		actions.closeRepoSettingsDialog();
	}
</script>

<SettingsShell
	bind:open
	title="Repository Settings"
	tabs={TABS}
	bind:activeTab
	onClose={() => actions.closeRepoSettingsDialog()}
>
	{#snippet content(_tab)}
		<section class="space-y-4">
			{#if parent === undefined}
				<p class="text-sm text-muted-foreground">Checking fork status…</p>
			{:else if !isFork}
				<p class="text-sm text-muted-foreground">
					This repository isn't a fork, so there's nothing to configure here.
				</p>
			{:else}
				<h3 class="text-base font-semibold">I'll be using this fork…</h3>
				<ForkUseChoice bind:value={use} {parentLabel} idPrefix="repo-settings" disabled={saving} />
				<ul class="space-y-1.5 text-xs text-muted-foreground">
					{#if use === 'parent'}
						<li>
							Pull requests targeting
							<span class="font-medium text-foreground">{parentLabel}</span> will be shown in the pull
							request list.
						</li>
						<li>
							"Create Issue on GitHub" will create issues in
							<span class="font-medium text-foreground">{parentLabel}</span>.
						</li>
						<li>
							"View on GitHub" will open
							<span class="font-medium text-foreground">{parentLabel}</span> in the browser.
						</li>
					{:else}
						<li>Pull requests and "Create Issue on GitHub" will target your own fork.</li>
						<li>"View on GitHub" will open your fork in the browser.</li>
					{/if}
				</ul>
			{/if}
		</section>
	{/snippet}

	{#snippet footer()}
		<Button
			variant="secondary"
			size="sm"
			onclick={() => actions.closeRepoSettingsDialog()}
			disabled={saving}
		>
			Cancel
		</Button>
		<Button size="sm" onclick={save} disabled={saving || !isFork}>Save</Button>
	{/snippet}
</SettingsShell>
