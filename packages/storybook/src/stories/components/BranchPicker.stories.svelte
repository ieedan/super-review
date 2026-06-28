<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import BranchPicker from '@super-review/ui/components/BranchPicker.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore } from '../../lib/store-harness';
	import { makeBranches, makePRs, makeRepos } from '../../lib/fixtures';

	// BranchPicker is the header control that switches branches and opens PRs. It
	// reads branches + PRs from the global `app` store; each story seeds them.
	const repo = makeRepos(1)[0];

	function seed(branchCount: number, prCount: number) {
		const branches = makeBranches(branchCount);
		seedStore({
			repos: [repo],
			activeRepo: repo,
			currentBranch: 'main',
			branches,
			prs: makePRs(prCount),
			prsHasMore: false,
			prsSource: 'fork'
		});
	}

	const { Story } = defineMeta({
		title: 'Components/Branch Picker',
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Default">
	{#snippet template()}
		<StoreScope setup={() => seed(12, 8)} frame={false}>
			<div class="flex min-h-96 items-start">
				<BranchPicker />
			</div>
		</StoreScope>
	{/snippet}
</Story>

<Story name="No pull requests">
	{#snippet template()}
		<StoreScope setup={() => seed(6, 0)} frame={false}>
			<div class="flex min-h-96 items-start">
				<BranchPicker />
			</div>
		</StoreScope>
	{/snippet}
</Story>

<!-- Performance: hundreds of branches and PRs in the picker's filtered, scrollable
     lists, proving search + render stay responsive on a busy repo. -->
<Story name="Performance (500 branches, 200 PRs)">
	{#snippet template()}
		<StoreScope setup={() => seed(500, 200)} frame={false}>
			<div class="flex min-h-[32rem] items-start">
				<BranchPicker />
			</div>
		</StoreScope>
	{/snippet}
</Story>
