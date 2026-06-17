<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Layers from '@lucide/svelte/icons/layers';
	import { actions, app } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import { harnessLabel } from '$lib/harness-logos';
	import HarnessLogo from './HarnessLogo.svelte';

	// Shown in place of a `.super-review/sessions/*.json` manifest's deferred diff.
	// The raw JSON is noise in a review; what a reader actually wants is to open
	// the documented session as a guided tour. This card mirrors the sidebar's
	// SessionsList entry and opens the session on click.
	interface Props {
		sessionId: string;
		// Lets the diff body fall back to the raw JSON diff for the rare reader who
		// wants to inspect the manifest itself.
		onViewRaw?: () => void;
	}

	let { sessionId, onViewRaw }: Props = $props();

	// The summary for this manifest, read from the loaded list. When the diff is
	// viewed outside the Sessions tab the list may not be loaded yet, so we kick
	// off one load (guarded so a missing/deleted session doesn't loop).
	const summary = $derived(app.sessions.find((s) => s.id === sessionId) ?? null);
	let triedLoad = $state(false);
	$effect(() => {
		if (summary || triedLoad) return;
		triedLoad = true;
		void actions.loadSessions();
	});
	// The session is gone (e.g. deleted on another branch) once a load has run and
	// still didn't turn it up. Show a muted, non-clickable note instead of a card
	// that links nowhere.
	const unresolved = $derived(triedLoad && !summary);

	function open(): void {
		void actions.viewSession(sessionId);
	}

	// Re-read nowTick so the relative timestamp ticks with the app's shared interval.
	function relative(updatedAt: number): string {
		void app.nowTick;
		return formatRelative(updatedAt);
	}
</script>

<div class="p-4">
	{#if unresolved}
		<p class="text-center text-xs text-muted-foreground">This session is no longer available.</p>
	{:else}
		<div
			role="button"
			tabindex="0"
			class="group mx-auto flex max-w-xl cursor-pointer items-start gap-3 rounded-lg border border-border bg-card/40 p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
			onclick={open}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					open();
				}
			}}
		>
		<div
			class="mt-0.5 grid size-7 flex-none place-items-center rounded-md border border-border bg-card"
			title={summary ? harnessLabel(summary.harness, summary.harnessLabel) : 'Session'}
		>
			{#if summary}
				<HarnessLogo harness={summary.harness} size={16} />
			{:else}
				<Layers class="size-4 text-muted-foreground" />
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<span class="truncate text-sm font-medium">{summary?.name ?? 'Documented session'}</span>
				<ChevronRight
					class="size-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5"
				/>
			</div>
			{#if summary?.description}
				<p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{summary.description}</p>
			{/if}
			{#if summary}
				<div
					class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums"
				>
					<span>{relative(summary.updatedAt)}</span>
					<span>·</span>
					{#if summary.stepCount > 0}
						<span>{summary.stepCount} step{summary.stepCount === 1 ? '' : 's'}</span>
						<span>·</span>
					{/if}
					<span>{summary.fileCount} file{summary.fileCount === 1 ? '' : 's'}</span>
					<span class="text-success">+{summary.additions}</span>
					<span class="text-destructive">−{summary.deletions}</span>
					{#if summary.branch}
						<span>·</span>
						<span class="truncate">{summary.branch}</span>
					{/if}
				</div>
			{/if}
			<p class="mt-1 text-[11px] text-muted-foreground">Open this session as a guided tour</p>
			</div>
		</div>
	{/if}
	{#if onViewRaw}
		<div class="mt-2 text-center">
			<button
				type="button"
				class="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
				onclick={onViewRaw}
			>
				View raw diff
			</button>
		</div>
	{/if}
</div>
