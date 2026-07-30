<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import CommitNotices from '@super-review/ui/components/CommitNotices.svelte';
	import ChangesetFlowRunner from '../../lib/ChangesetFlowRunner.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { harnessStatus, seedStore } from '../../lib/store-harness';
	import { DEFAULT_RUN_MS, installChangesetMock, pendingStatus } from '../../lib/changeset-flow';

	// The "Add a changeset?" row above the commit box, and the run its sparkle
	// kicks off. Stands in for the main process so the whole flow works here:
	// sparkle → shimmering "Generating changeset…" → the written changeset clears
	// the prompt.
	installChangesetMock();

	const HARNESSES = harnessStatus(['claude-code']);

	// Everything generateChangeset() reads before it reaches the mocked CLI: a
	// repo, a branch, an installed harness, and a branch missing a changeset.
	function seed(generating = false) {
		return () => {
			seedStore({
				activeRepo: { id: 'repo-1', name: 'super-review', path: '/tmp/super-review' },
				currentBranch: 'feat/generate-changesets',
				changesetStatus: pendingStatus(),
				changesetGenerating: generating,
				commitMessageHarnesses: HARNESSES,
				prefs: { commitMessageHarness: 'claude-code' }
			});
		};
	}

	const { Story } = defineMeta({
		title: 'Components/Changeset Notice',
		component: CommitNotices,
		parameters: { layout: 'centered' },
		args: { runMs: DEFAULT_RUN_MS }
	});

	// Roughly the width of the commit panel the notice sits in.
	const PANEL = 'w-[340px]';
</script>

<!-- The whole flow, driven by the real store action against a mocked CLI. -->
<Story name="Flow">
	{#snippet template(args)}
		<StoreScope frame={false} setup={seed()}>
			<ChangesetFlowRunner runMs={args.runMs} />
		</StoreScope>
	{/snippet}
</Story>

<!-- The prompt on its own: Add, and the sparkle that hands the branch to your
     agent. No CLI installed would hide the sparkle, so this story pins one. -->
<Story name="Prompt">
	{#snippet template()}
		<StoreScope frame={false} setup={seed()}>
			<div class={PANEL}>
				<CommitNotices />
			</div>
		</StoreScope>
	{/snippet}
</Story>

<!-- Mid-run: the agent's logo replaces the changeset butterfly and the line
     shimmers, with nothing to press until the changesets are written. -->
<Story name="Generating">
	{#snippet template()}
		<StoreScope frame={false} setup={seed(true)}>
			<div class={PANEL}>
				<CommitNotices />
			</div>
		</StoreScope>
	{/snippet}
</Story>
