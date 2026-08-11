<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import StoreScope from '../../lib/StoreScope.svelte';
	import CommitBox from '@super-review/ui/components/CommitBox.svelte';
	import { seedStore } from '../../lib/store-harness';
	import type { ChangedFile, LastCommit, LocalCommit } from '@super-review/core/types';

	// The commit box's summary of what's waiting to be pushed: the row under Undo
	// ("3 more commits") and the panel it opens on hover. Hover the row — or click
	// it to pin the panel and scroll it — to drive the whole thing.

	const REPO = { id: 'repo-1', name: 'super-review', path: '/tmp/super-review' };

	const CHANGED: ChangedFile[] = [
		{
			path: 'packages/ui/src/components/CommitBox.svelte',
			status: 'modified',
			additions: 12,
			deletions: 3
		}
	] as ChangedFile[];

	const MINUTE = 60_000;

	function localCommit(
		hash: string,
		subject: string,
		minutesAgo: number,
		files: LocalCommit['files']
	): LocalCommit {
		return {
			hash,
			shortHash: hash.slice(0, 7),
			subject,
			authorName: 'Aidan Bleser',
			authorEmail: 'aidan@example.com',
			// Fixed offsets from load time so the panel shows a spread of ages.
			authoredAt: Date.now() - minutesAgo * MINUTE,
			additions: files.reduce((n, f) => n + f.additions, 0),
			deletions: files.reduce((n, f) => n + f.deletions, 0),
			files
		};
	}

	function file(
		path: string,
		additions: number,
		deletions: number,
		status: LocalCommit['files'][number]['status'] = 'modified'
	): LocalCommit['files'][number] {
		return { path, status, additions, deletions, isBinary: false };
	}

	const COMMITS: LocalCommit[] = [
		localCommit('9f2c1ab0000', 'feat: summarize the commits waiting to be pushed', 1, [
			file('packages/ui/src/components/LocalCommitsSummary.svelte', 214, 0, 'added'),
			file('packages/ui/src/components/CommitBox.svelte', 9, 1),
			file('packages/core/src/git-service.ts', 132, 6),
			file('packages/core/src/types.ts', 34, 0)
		]),
		// A wide commit: its file list is longer than the ten rows the panel gives a
		// commit, so it scrolls in place rather than burying the commits below it.
		localCommit('4b7e55c0000', 'feat: crop avatars with image-cropper in settings', 46, [
			file('apps/web/src/lib/components/ui/image-cropper/image-cropper.svelte', 43, 0, 'added'),
			file('apps/web/src/lib/components/ui/image-cropper/image-cropper.svelte.ts', 167, 0, 'added'),
			file('apps/web/src/lib/components/ui/image-cropper/index.ts', 24, 0, 'added'),
			file('apps/web/src/lib/components/ui/image-cropper/types.ts', 44, 0, 'added'),
			file('apps/web/src/lib/components/ui/image-cropper/utils.ts', 85, 0, 'added'),
			file('apps/web/src/lib/components/ui/quicktype/quicktype.svelte', 2, 1),
			file('apps/web/src/lib/components/ui/snippet/snippet.svelte', 4, 5),
			file('apps/web/src/lib/components/settings/AvatarField.svelte', 96, 12),
			file('apps/web/src/lib/components/settings/ProfileForm.svelte', 31, 9),
			file('apps/web/src/lib/server/avatars.ts', 74, 0, 'added'),
			file('apps/web/src/routes/settings/+page.svelte', 18, 6),
			file('apps/web/src/routes/settings/+page.server.ts', 42, 3),
			file('apps/web/src/lib/convex/schema.ts', 6, 1),
			file('apps/web/package.json', 3, 0),
			file('pnpm-lock.yaml', 162, 4)
		]),
		localCommit('c01d3ef0000', 'chore: drop the old push-status polling', 190, [
			file('packages/ui/src/store.svelte.ts', 4, 63),
			file('packages/ui/src/push-poll.ts', 0, 91, 'deleted'),
			file('packages/core/src/push-status.ts', 12, 5),
			file('apps/desktop/src/main/ipc.ts', 2, 19)
		]),
		localCommit('7ad90060000', 'refactor: move the renderer into @super-review/ui', 1520, [
			file('packages/ui/src/components/DiffView.svelte', 6, 6, 'renamed'),
			file('apps/desktop/src/renderer/App.svelte', 3, 41),
			file('packages/ui/package.json', 18, 0, 'added'),
			file('pnpm-lock.yaml', 0, 0)
		])
	];

	function lastCommit(unpushedCount: number): LastCommit {
		return {
			hash: COMMITS[0].hash,
			subject: COMMITS[0].subject,
			body: '',
			relativeTime: '1 minute ago',
			canUndo: true,
			unpushedCount
		};
	}

	// `loadLocalCommits` re-fetches whenever this key changes; matching it means
	// the seeded list stands in for the git read (Storybook has no main process).
	function seed(count: number) {
		return () =>
			seedStore({
				activeRepo: REPO,
				currentBranch: 'feat/local-commits-summary',
				contextTab: 'unstaged',
				changedFiles: CHANGED,
				lastCommit: lastCommit(count),
				localCommits: COMMITS.slice(0, count),
				localCommitsKey: `${REPO.id}:${COMMITS[0].hash}:${count}`
			});
	}

	const { Story } = defineMeta({
		title: 'Components/Local Commits Summary',
		parameters: { layout: 'centered' }
	});
</script>

{#snippet sidebar()}
	<!-- The sidebar footer the commit box actually sits in: bottom-aligned, at the
	     width the pane opens to. -->
	<div class="flex h-full flex-col justify-end bg-sidebar">
		<CommitBox />
	</div>
{/snippet}

<!-- Four commits stacked up: the row reads "3 more commits" and the panel covers
     every one of them. -->
<Story name="A Stack Of Commits">
	{#snippet template()}
		<StoreScope width="360px" height="560px" setup={seed(4)}>
			{@render sidebar()}
		</StoreScope>
	{/snippet}
</Story>

<!-- Two commits: the smallest stack that gets a row at all. -->
<Story name="One More Commit">
	{#snippet template()}
		<StoreScope width="360px" height="560px" setup={seed(2)}>
			{@render sidebar()}
		</StoreScope>
	{/snippet}
</Story>

<!-- A single unpushed commit — the Undo row already says everything, so no row. -->
<Story name="Nothing Stacked Up">
	{#snippet template()}
		<StoreScope width="360px" height="560px" setup={seed(1)}>
			{@render sidebar()}
		</StoreScope>
	{/snippet}
</Story>
