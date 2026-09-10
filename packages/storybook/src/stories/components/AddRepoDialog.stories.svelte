<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AddRepoDialog from '@super-review/ui/components/AddRepoDialog.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore } from '../../lib/store-harness';
	import { makeGithubAccount } from '../../lib/fixtures';
	import {
		installAddRepoMock,
		type OccupiedPaths,
		type RepoListing
	} from '../../lib/add-repo-flow';
	import type { GithubAccount, RepoInfo } from '@super-review/core/types';

	// The add-repo dialog's clone flow lists the selected account's repositories
	// (window.api.github.listAccountRepositories) and suggests a destination
	// folder (repos.getCreateDefaults). Storybook has no main process, so each
	// story installs a mock for both and seeds the accounts the switcher shows.
	const personal = makeGithubAccount();
	const work: GithubAccount = {
		id: 'gh-2',
		login: 'ieedan-work',
		name: 'Aidan (work)',
		avatarUrl: '',
		addedAt: 1_700_000_100_000
	};

	const LISTINGS: RepoListing = {
		'gh-1': [
			{ owner: 'aidan', name: 'shadcn-svelte-extras', pushedAt: hoursAgo(3) },
			{ owner: 'aidan', name: 'super-review', pushedAt: hoursAgo(20), private: true },
			{ owner: 'aidan', name: 'jsrepo', pushedAt: hoursAgo(52) },
			{ owner: 'aidan', name: 'MDsveX', pushedAt: hoursAgo(120), fork: true },
			{ owner: 'aidan', name: 'QuikPW', pushedAt: hoursAgo(900), archived: true },
			{ owner: 'sveltejs', name: 'svelte', pushedAt: hoursAgo(1) },
			{ owner: 'sveltejs', name: 'kit', pushedAt: hoursAgo(6) },
			{ owner: 'huntabyte', name: 'bits-ui', pushedAt: hoursAgo(14) }
		],
		'gh-2': [
			{ owner: 'ieedan-work', name: 'internal-tools', pushedAt: hoursAgo(2), private: true },
			{ owner: 'acme-corp', name: 'billing-api', pushedAt: hoursAgo(9), private: true },
			{ owner: 'acme-corp', name: 'design-system', pushedAt: hoursAgo(48), private: true }
		]
	};

	function hoursAgo(hours: number): string {
		return new Date(Date.now() - hours * 3_600_000).toISOString();
	}

	// Projects already registered locally. The picker marks any listed repo that
	// matches one of these (by owner/name) with a "local" badge.
	const CLONED: RepoInfo[] = [
		{
			id: 'repo-local-1',
			path: '/Users/you/Documents/GitHub/super-review',
			name: 'super-review',
			githubOwner: 'aidan',
			githubRepo: 'super-review',
			lastOpenedAt: 1_700_000_000_000
		},
		{
			id: 'repo-local-2',
			path: '/Users/you/Documents/GitHub/bits-ui',
			name: 'bits-ui',
			githubOwner: 'huntabyte',
			githubRepo: 'bits-ui',
			lastOpenedAt: 1_699_900_000_000
		}
	];

	// Destinations that already exist on disk under the default local path. The
	// app's own repo list can't see these, so the dialog asks the filesystem.
	const OCCUPIED: OccupiedPaths = { tracker: 'repo', jsrepo: 'files' };

	function seed(
		accounts: GithubAccount[],
		listings: RepoListing,
		delayMs = 0,
		occupied: OccupiedPaths = {}
	): void {
		installAddRepoMock(listings, delayMs, occupied);
		seedStore({
			repos: CLONED,
			githubAccounts: accounts,
			activeGithubAccount: accounts[0] ?? null,
			addRepoDialogOpen: true
		});
	}

	const { Story } = defineMeta({
		title: 'Components/Add Repository Dialog',
		parameters: { layout: 'centered' }
	});
</script>

<!-- The dialog as it opens: the four ways to add a repo. -->
<Story name="Choose">
	{#snippet template()}
		<StoreScope setup={() => seed([personal], LISTINGS)} frame={false}>
			<AddRepoDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- Two signed-in accounts, so the account switcher in the clone picker's header
     has something to switch between. Click "Clone a repository" to reach it. -->
<Story name="Clone (two accounts)">
	{#snippet template()}
		<StoreScope setup={() => seed([personal, work], LISTINGS)} frame={false}>
			<AddRepoDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- Destinations that are already taken on disk: "tracker" holds a clone this
     app never registered, "jsrepo" holds unrelated files. Picking either blocks
     the clone with the reason git would give. -->
<Story name="Clone (destination taken)">
	{#snippet template()}
		<StoreScope
			setup={() =>
				seed(
					[personal],
					{
						'gh-1': [
							...LISTINGS['gh-1'],
							{ owner: 'aidan', name: 'tracker', pushedAt: hoursAgo(7) }
						]
					},
					0,
					OCCUPIED
				)}
			frame={false}
		>
			<AddRepoDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- A slow listing, so the picker's loading state is reachable. -->
<Story name="Clone (slow listing)">
	{#snippet template()}
		<StoreScope setup={() => seed([personal], LISTINGS, 4000)} frame={false}>
			<AddRepoDialog />
		</StoreScope>
	{/snippet}
</Story>

<!-- Nobody signed in: the GitHub tab has nothing to list, so the dialog opens on
     the URL tab and the picker offers a sign-in instead. -->
<Story name="Clone (signed out)">
	{#snippet template()}
		<StoreScope setup={() => seed([], {})} frame={false}>
			<AddRepoDialog />
		</StoreScope>
	{/snippet}
</Story>
