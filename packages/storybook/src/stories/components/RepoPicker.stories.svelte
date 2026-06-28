<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import RepoSwitcher from '@super-review/ui/components/RepoSwitcher.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore } from '../../lib/store-harness';
	import { makeRepos } from '../../lib/fixtures';
	import { SvelteSet } from 'svelte/reactivity';

	// RepoSwitcher is the header's repository picker (open / switch / recent). It
	// reads the repo list and active repo from the global `app` store.
	function seed(repoCount: number, dirtyEvery = 4) {
		const repos = makeRepos(repoCount);
		const dirty = new SvelteSet<string>();
		repos.forEach((r, i) => i % dirtyEvery === 0 && dirty.add(r.id));
		seedStore({
			repos,
			activeRepo: repos[0] ?? null,
			dirtyRepoIds: dirty,
			recentRepoCount: 5,
			platform: 'darwin'
		});
	}

	const { Story } = defineMeta({
		title: 'Components/Repo Picker',
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Default">
	{#snippet template()}
		<StoreScope setup={() => seed(8)} frame={false}>
			<div class="flex min-h-96 items-start">
				<RepoSwitcher />
			</div>
		</StoreScope>
	{/snippet}
</Story>

<Story name="Single repo">
	{#snippet template()}
		<StoreScope setup={() => seed(1, 99)} frame={false}>
			<div class="flex min-h-96 items-start">
				<RepoSwitcher />
			</div>
		</StoreScope>
	{/snippet}
</Story>

<!-- Performance: a long repo list to confirm the picker's filter + frecency sort
     stay snappy for someone juggling hundreds of projects. -->
<Story name="Performance (400 repos)">
	{#snippet template()}
		<StoreScope setup={() => seed(400)} frame={false}>
			<div class="flex min-h-[32rem] items-start">
				<RepoSwitcher />
			</div>
		</StoreScope>
	{/snippet}
</Story>
