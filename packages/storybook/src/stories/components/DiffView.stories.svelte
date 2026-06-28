<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DiffView from '@super-review/ui/components/DiffView.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore, seedDiffCache } from '../../lib/store-harness';
	import { makeChangedFiles, makeRepos } from '../../lib/fixtures';
	import type { DiffLayout } from '@super-review/core/types';

	// DiffView renders the file-by-file diff using @pierre/diffs (real syntax
	// highlighting in a worker). It reads everything from the global `app` store
	// and pulls each file's patch from the diff cache, so each story seeds both.
	const repo = makeRepos(1)[0];

	function seed(fileCount: number, layout: DiffLayout, viewMode: 'split' | 'unified' = 'split') {
		const files = makeChangedFiles(fileCount);
		seedStore({
			repos: [repo],
			activeRepo: repo,
			currentBranch: 'feat/storybook-setup',
			contextTab: 'branch',
			diffContext: { kind: 'workingTree' },
			changedFiles: files,
			selectedFile: files[0]?.path ?? null,
			diffLayout: layout,
			viewMode
		});
		seedDiffCache(repo.id, files);
	}

	const { Story } = defineMeta({
		title: 'Components/Diff View',
		parameters: { layout: 'centered' }
	});
</script>

<!-- Scroll layout: every file's diff stacked, the way a full review reads. -->
<Story name="Scroll (all files)">
	{#snippet template()}
		<StoreScope setup={() => seed(8, 'scroll')} width="980px" height="680px">
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<!-- Single layout: one file's diff at a time. -->
<Story name="Single file">
	{#snippet template()}
		<StoreScope setup={() => seed(8, 'single')} width="980px" height="680px">
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<Story name="Unified view">
	{#snippet template()}
		<StoreScope setup={() => seed(8, 'scroll', 'unified')} width="980px" height="680px">
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<!--
	Performance: a large changeset of differently sized files (the magnitudes
	cycle from one-line tweaks up to ~2,400-line files, see makeChangedFiles), all
	rendered through the diff worker pool. This is the headline stress test for the
	diff view: render scheduling, virtualization and worker throughput under a big,
	heterogeneous diff.
-->
<Story name="Performance (300 mixed-size files)">
	{#snippet template()}
		<StoreScope setup={() => seed(300, 'scroll')} width="980px" height="720px">
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>
