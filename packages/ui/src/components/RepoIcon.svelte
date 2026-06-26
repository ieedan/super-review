<script lang="ts">
	import { app } from '@super-review/ui/store.svelte';
	import { cn, repoPlaceholder } from '@super-review/ui/utils';
	import type { RepoInfo } from '@super-review/core/types';

	// Renders a repo's icon with a graceful fallback chain:
	//   1. the repo's own brand icon (`iconDataUrl`, theme-aware)
	//   2. the GitHub owner's avatar, when the repo has no icon file
	//   3. a deterministic lettered placeholder, when there's no owner (or the
	//      avatar fails to load)
	let { repo, size = 'md' }: { repo: RepoInfo | null | undefined; size?: 'sm' | 'md' } = $props();

	// Match the two existing call sites: the trigger button uses a smaller icon
	// and font than the dropdown rows.
	const dims = $derived(
		size === 'sm' ? { box: 'size-4', text: 'text-[9px]' } : { box: 'size-5', text: 'text-[11px]' }
	);

	// Pick the icon variant for the current theme. Repos that ship a light/dark
	// pair (e.g. `favicon-light.svg` + `favicon-dark.svg`) expose both; everyone
	// else only has `iconDataUrl`, so we fall back to it. Reactive on `app.theme`.
	const iconDataUrl = $derived(
		app.theme === 'dark' && repo?.iconDataUrlDark ? repo.iconDataUrlDark : repo?.iconDataUrl
	);

	// GitHub serves owner avatars unauthenticated at `github.com/<login>.png` and
	// redirects to the CDN; this works for both users and orgs. Used as a fallback
	// "favicon" when the repo ships no icon file we can find.
	const avatarUrl = $derived(
		repo?.githubOwner ? `https://github.com/${repo.githubOwner}.png?size=40` : undefined
	);

	// Remember an avatar that 404s / fails to load so we drop to the lettered
	// placeholder instead of a broken image. Keyed by URL so a reused component
	// instance (the rows are virtualized) re-tries when it shows a different repo.
	let failedAvatar = $state<string | undefined>(undefined);
	const avatarOk = $derived(avatarUrl !== undefined && failedAvatar !== avatarUrl);

	const placeholder = $derived(repoPlaceholder(repo?.name ?? ''));
</script>

{#if iconDataUrl}
	<img src={iconDataUrl} alt="" class={cn(dims.box, 'rounded-sm object-contain')} />
{:else if avatarUrl && avatarOk}
	<img
		src={avatarUrl}
		alt=""
		class={cn(dims.box, 'rounded-full object-cover')}
		onerror={() => (failedAvatar = avatarUrl)}
	/>
{:else}
	<span
		class={cn(
			'grid place-items-center rounded-sm leading-none font-semibold',
			dims.box,
			dims.text,
			placeholder.toneClass
		)}
	>
		{placeholder.initial}
	</span>
{/if}
