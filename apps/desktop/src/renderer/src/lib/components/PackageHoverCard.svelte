<script lang="ts">
	// The package.json hover card. One instance is mounted in the diff view; it
	// reads the shared `packageHover` controller (driven by Pierre's token hover
	// events) and renders npm metadata for whatever name/version is under the
	// pointer. Built on the app's Popover primitive (bits-ui) anchored to the
	// hovered token via `customAnchor`, so it gets Floating UI positioning,
	// collision handling, and portaling for free rather than hand-rolled.

	import Package from '@lucide/svelte/icons/package';
	import Tag from '@lucide/svelte/icons/tag';
	import Calendar from '@lucide/svelte/icons/calendar';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Scale from '@lucide/svelte/icons/scale';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { Popover, PopoverContent } from './ui/popover';
	import { Badge } from './ui/badge';
	import { getNpmInfo, type NpmInfoState } from '$lib/npm-info.svelte';
	import {
		packageHover,
		keepPackageHover,
		scheduleHidePackageHover,
		closePackageHover
	} from '$lib/package-hover.svelte';
	import type { NpmPackageInfo } from '@shared/types';

	// The npm request state for the currently-hovered package. `getNpmInfo` is
	// reactive (and memoized), so this re-resolves from loading → loaded/error.
	const infoState = $derived<NpmInfoState | null>(
		packageHover.target ? getNpmInfo(packageHover.target.name) : null
	);

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
	open={packageHover.open}
	onOpenChange={(next) => {
		if (!next) closePackageHover();
	}}
>
	<PopoverContent
		customAnchor={packageHover.anchor}
		side="top"
		align="start"
		sideOffset={6}
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
					<div class="mt-0.5 text-muted-foreground">
						{#if target.kind === 'version'}
							<Tag class="size-4" />
						{:else}
							<Package class="size-4" />
						{/if}
					</div>
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
					{/if}
				</div>
			</div>
		{/if}
	</PopoverContent>
</Popover>
