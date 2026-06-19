<script lang="ts">
	// The package.json hover card. One instance is mounted in the diff view; it
	// reads the shared `packageHover` controller (driven by Pierre's token hover
	// events) and renders npm metadata for whatever name/version is under the
	// pointer. Built on the app's Popover primitive (bits-ui) anchored to the
	// hovered token via `customAnchor`, so it gets Floating UI positioning,
	// collision handling, and portaling for free rather than hand-rolled.

	import Tag from '@lucide/svelte/icons/tag';
	import Calendar from '@lucide/svelte/icons/calendar';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Scale from '@lucide/svelte/icons/scale';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Popover, PopoverContent } from './ui/popover';
	import { Badge } from './ui/badge';
	import { getNpmInfo, requestNpmInfo, type NpmInfoState } from '$lib/npm-info.svelte';
	import {
		getReleaseNotes,
		requestReleaseNotes,
		getReleaseNotesRange,
		requestReleaseNotesRange,
		type ReleaseNotesState,
		type ReleaseNotesRangeState
	} from '$lib/release-notes.svelte';
	import {
		packageHover,
		keepPackageHover,
		scheduleHidePackageHover,
		closePackageHover,
		setPackageHoverPinned
	} from '$lib/package-hover.svelte';
	import { app } from '$lib/store.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import '$lib/markdown.css';
	import type { NpmPackageInfo, ReleaseNotes } from '@shared/types';

	// Kick off the fetch as a side effect when the hovered package changes.
	// `requestNpmInfo` writes the reactive cache, so it must run in an `$effect`,
	// not inside the `$derived` below (mutating state during derivation throws
	// `state_unsafe_mutation`).
	$effect(() => {
		const name = packageHover.target?.name;
		if (name) requestNpmInfo(name);
	});

	// The npm request state for the currently-hovered package. Pure reactive read
	// of the cache, so it re-resolves loading → loaded/error on its own. The cache
	// is empty until the effect above populates it, so treat "not yet there" as
	// loading.
	const infoState = $derived<NpmInfoState | null>(
		packageHover.target ? (getNpmInfo(packageHover.target.name) ?? { status: 'loading' }) : null
	);

	// Only actually open the popover once the npm request has settled, so the card
	// never flashes a "Loading…" state: it stays hidden during the hover-intent
	// delay + fetch and pops in already populated (loaded or, for a missing/broken
	// package, the error).
	const contentReady = $derived(infoState?.status === 'loaded' || infoState?.status === 'error');
	const cardOpen = $derived(packageHover.armed && contentReady);

	// Open toward whichever side of the hovered token has more room, so expanding
	// the changelog doesn't shove the card across to the other side. Decided from
	// the token's viewport position at hover time (the anchor object changes per
	// hover, so this recomputes then); it stays put while the card is open and the
	// disclosure grows. Collision flipping stays on as a last-resort backstop.
	const preferredSide = $derived.by<'top' | 'bottom'>(() => {
		const rect = packageHover.anchor?.getBoundingClientRect();
		if (!rect) return 'top';
		const roomAbove = rect.top;
		const roomBelow = window.innerHeight - rect.bottom;
		return roomBelow > roomAbove ? 'bottom' : 'top';
	});

	// The changelog disclosure's open state. While it's expanded we pin the card
	// (see the effect below) so growing/repositioning can't dismiss it. Reset to
	// collapsed whenever the hovered package changes so each card starts closed.
	let notesOpen = $state(false);
	$effect(() => {
		void packageHover.target?.name;
		notesOpen = false;
	});
	$effect(() => {
		setPackageHoverPinned(notesOpen);
	});

	// Code-hosting platforms whose favicon is the platform's own logo, not the
	// package's. Tons of packages set `homepage` to their repo (e.g. globals points
	// at github.com/sindresorhus/globals#readme), and DuckDuckGo happily returns
	// GitHub's octocat for that, which is meaningless here (and invisibly dark on
	// the dark card). Skip the favicon for these so the card shows no icon instead.
	// Note these are the REPO hosts only; project sites on `*.github.io` /
	// `*.pages.dev` / `*.vercel.app` etc. keep their own favicon.
	const CODE_HOST_DOMAINS = [
		'github.com',
		'githubusercontent.com',
		'gitlab.com',
		'bitbucket.org',
		'codeberg.org',
		'gitea.com',
		'sr.ht',
		'sourceforge.net'
	];
	function isCodeHost(host: string): boolean {
		return CODE_HOST_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
	}

	// When the loaded package has a homepage, show that site's favicon as the
	// card icon (it identifies the package better than a generic box). We use
	// DuckDuckGo's icon service, which resolves the site's declared `<link>`
	// icons for us; null until info loads, when there's no usable homepage, or
	// when the homepage is just a code-repo URL (its favicon is the platform logo).
	const faviconUrl = $derived.by(() => {
		if (infoState?.status !== 'loaded' || !infoState.info.homepage) return null;
		try {
			const host = new URL(infoState.info.homepage).hostname.replace(/^www\./, '');
			if (!host || isCodeHost(host)) return null;
			return `https://icons.duckduckgo.com/ip3/${host}.ico`;
		} catch {
			// Malformed homepage URL; fall back to no icon.
			return null;
		}
	});

	// The favicon URL that failed to load, so we fall back to the kind icon for
	// it. Keyed by URL (not a boolean) so hovering a different package whose
	// favicon is fine isn't suppressed by a previous failure.
	let brokenFaviconUrl = $state<string | null>(null);

	// ─── Changelog / release notes ───────────────────────────────────────────
	// The package's repository when it's on GitHub; drives both the changelog
	// link and the release-notes fetch. null for GitLab/Bitbucket/none.
	const githubRepoUrl = $derived.by(() => {
		if (infoState?.status !== 'loaded' || !infoState.info.repositoryUrl) return null;
		try {
			const host = new URL(infoState.info.repositoryUrl).hostname;
			return host === 'github.com' || host === 'www.github.com'
				? infoState.info.repositoryUrl
				: null;
		} catch {
			return null;
		}
	});

	// The repo's Releases page: the reliable changelog fallback, shown whenever
	// the package is on GitHub regardless of whether inline notes resolve.
	const changelogUrl = $derived(
		githubRepoUrl ? `${githubRepoUrl.replace(/\/$/, '')}/releases` : null
	);

	// The canonical npm name, needed to match monorepo `name@version` release tags.
	const pkgName = $derived(infoState?.status === 'loaded' ? infoState.info.name : null);

	// The dependency's resolved version on each side of the diff. `currentVersion`
	// is the version in the file (the new side, or the old side for a removed dep);
	// `previousVersion` is the old side's version, but only when the dep is present
	// on both sides so we can tell a real change from an add/remove.
	const currentVersion = $derived.by(() => {
		const t = packageHover.target;
		const range = t?.newRange ?? t?.oldRange ?? t?.version ?? null;
		return range ? baseVersion(range) : null;
	});
	const previousVersion = $derived.by(() => {
		const t = packageHover.target;
		if (!t?.oldRange || !t?.newRange) return null;
		return baseVersion(t.oldRange);
	});
	// Did the version actually change in the diff? If so we show the changelog for
	// every release between the two; otherwise just the current version's.
	const versionChanged = $derived(
		!!previousVersion && !!currentVersion && previousVersion !== currentVersion
	);

	// Unchanged dep → fetch just the current version's release (side effects, so
	// these live in `$effect`s).
	$effect(() => {
		if (githubRepoUrl && pkgName && currentVersion && !versionChanged) {
			requestReleaseNotes(githubRepoUrl, pkgName, currentVersion);
		}
	});
	const singleState = $derived<ReleaseNotesState | null>(
		pkgName && currentVersion && !versionChanged
			? (getReleaseNotes(pkgName, currentVersion) ?? { status: 'loading' })
			: null
	);

	// Changed dep → fetch every release between the two versions.
	$effect(() => {
		if (githubRepoUrl && pkgName && versionChanged && previousVersion && currentVersion) {
			requestReleaseNotesRange(githubRepoUrl, pkgName, previousVersion, currentVersion);
		}
	});
	const rangeState = $derived<ReleaseNotesRangeState | null>(
		pkgName && versionChanged && previousVersion && currentVersion
			? (getReleaseNotesRange(pkgName, previousVersion, currentVersion) ?? { status: 'loading' })
			: null
	);

	// Disclosure title + the release sections to render, unified across the two
	// cases. The title keeps the diff's direction (old → new) even on a downgrade.
	const disclosureTitle = $derived(
		versionChanged && previousVersion && currentVersion
			? `What changed ${previousVersion} → ${currentVersion}`
			: currentVersion
				? `What's new in ${currentVersion}`
				: "What's new"
	);
	const sections = $derived.by<ReleaseNotes[]>(() => {
		if (versionChanged) return rangeState?.status === 'loaded' ? rangeState.releases : [];
		const single = singleState?.status === 'loaded' ? singleState.release : null;
		return single ? [single] : [];
	});
	const rangeTruncated = $derived(
		versionChanged && rangeState?.status === 'loaded' ? rangeState.truncated : false
	);

	// Render each release's markdown to sanitized HTML for the disclosure. Async +
	// theme-dependent, so compute into local state from an effect.
	let renderedSections = $state<{ tag: string; html: string; htmlUrl: string }[]>([]);
	$effect(() => {
		const secs = sections;
		const theme = app.theme;
		if (secs.length === 0) {
			renderedSections = [];
			return;
		}
		let cancelled = false;
		void Promise.all(
			secs.map(async (s) => ({
				tag: s.tag,
				htmlUrl: s.htmlUrl,
				html: s.body?.trim() ? await renderMarkdown(s.body, theme) : ''
			}))
		).then((rendered) => {
			if (!cancelled) renderedSections = rendered;
		});
		return () => {
			cancelled = true;
		};
	});

	// Resolve a package.json version range to a concrete version present in the
	// registry's `time` map. We don't ship a semver resolver, so we take the
	// first `x.y.z` in the range — the common `^`/`~`/exact cases all pin to that
	// base version's publish date. Returns null for ranges with no such version
	// (`*`, `workspace:*`, git/file specifiers).
	function baseVersion(range: string): string | null {
		const m = range.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?/);
		return m ? m[0] : null;
	}

	function formatDate(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	// A compact "3 days ago" / "2 years ago" relative string to pair with the
	// absolute date — gives a sense of staleness at a glance.
	function relativeTime(iso: string): string | null {
		const then = new Date(iso).getTime();
		if (Number.isNaN(then)) return null;
		const seconds = Math.round((Date.now() - then) / 1000);
		if (seconds < 60) return 'just now';
		const units: [Intl.RelativeTimeFormatUnit, number][] = [
			['year', 31536000],
			['month', 2592000],
			['week', 604800],
			['day', 86400],
			['hour', 3600],
			['minute', 60]
		];
		const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
		for (const [unit, secs] of units) {
			if (seconds >= secs) return rtf.format(-Math.floor(seconds / secs), unit);
		}
		return 'just now';
	}

	function deprecationFor(info: NpmPackageInfo, version: string | null): string | undefined {
		if (!info.deprecations) return undefined;
		if (version && info.deprecations[version]) return info.deprecations[version];
		if (info.latestVersion && info.deprecations[info.latestVersion])
			return info.deprecations[info.latestVersion];
		return undefined;
	}

	function open(url: string, e: MouseEvent): void {
		e.preventDefault();
		void window.api.shell.openExternal(url);
	}

	function npmUrl(name: string): string {
		return `https://www.npmjs.com/package/${name}`;
	}

	// Derived view-model for the version card: the resolved base version, its
	// publish info, and how it compares to latest.
	const versionView = $derived.by(() => {
		if (
			!packageHover.target ||
			packageHover.target.kind !== 'version' ||
			infoState?.status !== 'loaded'
		) {
			return null;
		}
		const info = infoState.info;
		const range = packageHover.target.version;
		const resolved = baseVersion(range);
		const publishedIso = resolved ? info.time[resolved] : undefined;
		return {
			range,
			resolved,
			publishedIso,
			latest: info.latestVersion,
			isLatest: resolved != null && resolved === info.latestVersion,
			latestIso: info.latestVersion ? info.time[info.latestVersion] : undefined,
			deprecated: deprecationFor(info, resolved)
		};
	});
</script>

<Popover
	open={cardOpen}
	onOpenChange={(next) => {
		if (!next) closePackageHover();
	}}
>
	<PopoverContent
		customAnchor={packageHover.anchor}
		side={preferredSide}
		align="start"
		sideOffset={2}
		trapFocus={false}
		onOpenAutoFocus={(e) => e.preventDefault()}
		onCloseAutoFocus={(e) => e.preventDefault()}
		class="w-80 gap-0 p-0"
	>
		{#if packageHover.target}
			{@const target = packageHover.target}
			<!-- The card keeps itself open while the pointer is on it, so its links
			     stay clickable; leaving starts the shared close timer. -->
			<div
				role="tooltip"
				onpointerenter={keepPackageHover}
				onpointerleave={scheduleHidePackageHover}
			>
				<!-- Header: package identity + npm link, shown for both card kinds. -->
				<div class="flex items-start gap-2 p-3 pb-2">
					<!-- Icon: the homepage favicon when we have one. When there's no
					     homepage or the favicon fails to load we render nothing at all
					     (not a placeholder), so the name/version text fills the row from
					     the left edge. -->
					{#if faviconUrl && brokenFaviconUrl !== faviconUrl}
						<div class="mt-0.5 text-muted-foreground">
							<img
								src={faviconUrl}
								alt=""
								class="size-4 rounded-sm"
								onerror={() => (brokenFaviconUrl = faviconUrl)}
							/>
						</div>
					{/if}
					<div class="min-w-0 flex-1">
						<a
							href={npmUrl(target.name)}
							onclick={(e) => open(npmUrl(target.name), e)}
							class="group inline-flex items-center gap-1 font-medium break-all hover:underline"
						>
							{target.name}
							<ExternalLink
								class="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
							/>
						</a>
						{#if target.kind === 'version'}
							<p class="font-mono text-xs text-muted-foreground">{target.version}</p>
						{/if}
					</div>
				</div>

				<div class="border-t border-foreground/10 px-3 py-2.5 text-sm">
					{#if infoState?.status === 'loading'}
						<div class="flex items-center gap-2 text-muted-foreground">
							<LoaderCircle class="size-3.5 animate-spin" />
							<span>Loading from npm…</span>
						</div>
					{:else if infoState?.status === 'error'}
						<p class="text-muted-foreground">{infoState.error}</p>
					{:else if infoState?.status === 'loaded'}
						{@const info = infoState.info}
						{#if target.kind === 'name'}
							<!-- Package card: description, latest, license, links. -->
							{#if info.description}
								<p class="text-foreground/90">{info.description}</p>
							{/if}
							{@const dep = deprecationFor(info, null)}
							{#if dep}
								<div class="mt-2 flex items-start gap-1.5 text-warning">
									<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
									<span class="text-xs">Deprecated: {dep}</span>
								</div>
							{/if}
							<div class="mt-2 flex flex-wrap items-center gap-1.5">
								{#if info.latestVersion}
									<Badge variant="secondary" class="font-mono">
										<Tag class="size-3" />
										latest {info.latestVersion}
									</Badge>
								{/if}
								{#if info.latestVersion && info.time[info.latestVersion]}
									<Badge variant="muted">
										<Calendar class="size-3" />
										{relativeTime(info.time[info.latestVersion])}
									</Badge>
								{/if}
								{#if info.license}
									<Badge variant="muted">
										<Scale class="size-3" />
										{info.license}
									</Badge>
								{/if}
							</div>
							{#if info.keywords && info.keywords.length > 0}
								<p class="mt-2 truncate text-xs text-muted-foreground">
									{info.keywords.join(' · ')}
								</p>
							{/if}
							{#if info.homepage || info.repositoryUrl}
								<div class="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
									{#if info.homepage}
										<a
											href={info.homepage}
											onclick={(e) => open(info.homepage!, e)}
											class="inline-flex items-center gap-1 text-primary hover:underline"
										>
											Homepage <ExternalLink class="size-3" />
										</a>
									{/if}
									{#if info.repositoryUrl}
										<a
											href={info.repositoryUrl}
											onclick={(e) => open(info.repositoryUrl!, e)}
											class="inline-flex items-center gap-1 text-primary hover:underline"
										>
											Repository <ExternalLink class="size-3" />
										</a>
									{/if}
								</div>
							{/if}
						{:else if versionView}
							<!-- Version card: when this range was published + latest. -->
							{#if versionView.publishedIso && versionView.resolved}
								<div class="flex items-center gap-2">
									<Calendar class="size-3.5 text-muted-foreground" />
									<span>
										<span class="font-mono">{versionView.resolved}</span> published
										<span class="text-foreground/90">{formatDate(versionView.publishedIso)}</span>
									</span>
								</div>
								<p class="mt-0.5 pl-[1.375rem] text-xs text-muted-foreground">
									{relativeTime(versionView.publishedIso)}
								</p>
							{:else}
								<p class="text-muted-foreground">No published date for this version range.</p>
							{/if}
							<div class="mt-2 flex flex-wrap items-center gap-1.5">
								{#if versionView.isLatest}
									<Badge variant="success">Up to date</Badge>
								{:else if versionView.latest}
									<Badge variant="warning" class="font-mono">
										<Tag class="size-3" />
										latest {versionView.latest}
									</Badge>
									{#if versionView.latestIso}
										<Badge variant="muted">
											<Calendar class="size-3" />
											{relativeTime(versionView.latestIso)}
										</Badge>
									{/if}
								{/if}
							</div>
							{#if versionView.deprecated}
								<div class="mt-2 flex items-start gap-1.5 text-warning">
									<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
									<span class="text-xs">Deprecated: {versionView.deprecated}</span>
								</div>
							{/if}
						{/if}

						<!-- Changelog: a collapsible of the release notes (just the current
						     version when the dep didn't change, or every release between the
						     old and new versions when it did), plus a link to the full
						     Releases page either way (the reliable fallback). -->
						{#if changelogUrl}
							{@const changelog = changelogUrl}
							<div class="mt-2.5 border-t border-foreground/10 pt-2.5">
								{#if renderedSections.length > 0}
									<details class="group" bind:open={notesOpen}>
										<summary
											class="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground/90 select-none hover:text-foreground [&::-webkit-details-marker]:hidden"
										>
											<ChevronRight
												class="size-3.5 shrink-0 transition-transform group-[[open]]:rotate-90"
											/>
											{disclosureTitle}
										</summary>
										<div class="mt-2 max-h-48 space-y-3 overflow-y-auto rounded-md bg-muted/40 p-2">
											{#each renderedSections as section (section.tag)}
												<div class="space-y-1">
													<a
														href={section.htmlUrl}
														onclick={(e) => open(section.htmlUrl, e)}
														class="inline-flex items-center gap-1 font-mono text-xs font-medium text-foreground/90 hover:underline"
													>
														{section.tag}
													</a>
													{#if section.html}
														<!-- eslint-disable-next-line svelte/no-at-html-tags -->
														<div class="markdown-body text-xs">{@html section.html}</div>
													{:else}
														<p class="text-xs text-muted-foreground">No release notes.</p>
													{/if}
												</div>
											{/each}
											{#if rangeTruncated}
												<p class="text-xs text-muted-foreground">
													Older releases not shown. Open the changelog for the rest.
												</p>
											{/if}
										</div>
									</details>
								{/if}
								<a
									href={changelog}
									onclick={(e) => open(changelog, e)}
									class="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
								>
									Changelog <ExternalLink class="size-3" />
								</a>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</PopoverContent>
</Popover>
