<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import FileList from '@super-review/ui/components/FileList.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore } from '../../lib/store-harness';
	import { makeChangedFiles, makeRepos } from '../../lib/fixtures';

	// FileList is the sidebar's changed-files tree/list. It's entirely driven by
	// the global `app` store, so each story seeds that store (repo, branch,
	// context tab + the changed files) before mounting the component.
	const repo = makeRepos(1)[0];

	function seed(fileCount: number, layout: 'tree' | 'list' = 'tree') {
		const files = makeChangedFiles(fileCount);
		seedStore({
			repos: [repo],
			activeRepo: repo,
			currentBranch: 'feat/storybook-setup',
			contextTab: 'branch',
			changedFiles: files,
			selectedFile: files[0]?.path ?? null,
			branchFileListLayout: layout,
			unstagedFileListLayout: layout,
			showFileIcons: true
		});
	}

	const { Story } = defineMeta({
		title: 'Components/File List',
		parameters: { layout: 'centered' }
	});
</script>

<Story name="Tree">
	{#snippet template()}
		<StoreScope setup={() => seed(24, 'tree')} width="340px" height="600px">
			<FileList />
		</StoreScope>
	{/snippet}
</Story>

<Story name="Flat list">
	{#snippet template()}
		<StoreScope setup={() => seed(24, 'list')} width="340px" height="600px">
			<FileList />
		</StoreScope>
	{/snippet}
</Story>

<Story name="Empty">
	{#snippet template()}
		<StoreScope
			setup={() =>
				seedStore({
					repos: [repo],
					activeRepo: repo,
					currentBranch: 'main',
					contextTab: 'branch',
					changedFiles: []
				})}
			width="340px"
			height="600px"
		>
			<FileList />
		</StoreScope>
	{/snippet}
</Story>

<!-- Performance: a few thousand changed files across deep folders. The list is
     virtualized (svelte-tiny-virtual-list), so this proves scrolling and the
     tree build stay smooth on a huge changeset. -->
<Story name="Performance (5000 files)">
	{#snippet template()}
		<StoreScope setup={() => seed(5000, 'tree')} width="340px" height="700px">
			<FileList />
		</StoreScope>
	{/snippet}
</Story>
