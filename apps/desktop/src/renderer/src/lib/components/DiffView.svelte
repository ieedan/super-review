<script lang="ts">
	import { onDestroy } from 'svelte';
	import Inbox from '@lucide/svelte/icons/inbox';
	import DiffFileSection from './DiffFileSection.svelte';
	import SessionStepHeader from './SessionStepHeader.svelte';
	import NoChanges from './NoChanges.svelte';
	import FindBar from './FindBar.svelte';
	import { app, actions } from '$lib/store.svelte';
	import { find, openFind, closeFind, setFindRoot } from '$lib/diff-find.svelte';
	import { shortcut, type Options as ShortcutOptions } from '$lib/actions/shortcut.svelte';
	import { matchesFileQuery } from '$lib/file-search';
	import { tourGroups } from '$lib/session-tour';
	import type { ChangedFile } from '@shared/types';

	// Mirror the sidebar's path filter so hidden files don't render a diff
	// section here either. Both views read from `app.fileSearchQuery` and run it
	// through the same matcher (substring + glob; see matchesFileQuery).
	const visibleFiles = $derived.by<ChangedFile[]>(() => {
		const q = app.fileSearchQuery.trim();
		if (!q) return app.changedFiles;
		return app.changedFiles.filter((f) => matchesFileQuery(f.path, q));
	});

	// The flat render plan: for a session tour, file sections are grouped under
	// step headers (in tour order); otherwise it's just the files in order. The
	// "Other changes" group carries no step number (index 0).
	type PlanItem =
		| { kind: 'step'; id: string; title: string; body: string; index: number; total: number }
		// `prerender` marks a file we render off-screen ahead of time (single
		// layout) so navigating to it is instant — see displayPlan below.
		| { kind: 'file'; file: ChangedFile; prerender?: boolean };
	const renderPlan = $derived.by<PlanItem[]>(() => {
		// Step grouping only in a session's Tour view; the Changes view (and every
		// non-session context) renders the files flat.
		const groups =
			app.sessionView === 'tour' ? tourGroups(app.activeSessionDetail, visibleFiles) : null;
		if (!groups) return visibleFiles.map((f) => ({ kind: 'file', file: f }));
		const total = groups.filter((g) => !g.synthetic).length;
		let stepIndex = 0;
		const out: PlanItem[] = [];
		for (const g of groups) {
			if (!g.synthetic) stepIndex++;
			out.push({
				kind: 'step',
				id: g.id,
				title: g.title,
				body: g.body,
				index: g.synthetic ? 0 : stepIndex,
				total
			});
			for (const f of g.files) out.push({ kind: 'file', file: f });
		}
		return out;
	});

	// What the diff view actually renders. In the default 'scroll' layout that's
	// the whole plan (every file, one long scroll). In 'single' layout we render
	// just the selected file's section — plus its preceding step header for tour
	// context — so the user reviews one diff at a time, GitHub Desktop-style,
	// switching files from the sidebar.
	//
	// We also keep the previous and next file rendered off-screen (`prerender`)
	// so stepping to either is instant instead of waiting on a fetch + Pierre
	// render. The {#each} below is keyed by path, so when a neighbour becomes the
	// selected file its already-rendered section is reused in place rather than
	// rebuilt.
	const displayPlan = $derived.by<PlanItem[]>(() => {
		if (app.diffLayout !== 'single') return renderPlan;
		const fileItems = renderPlan.filter((it) => it.kind === 'file');
		if (fileItems.length === 0) return [];
		const sel = app.selectedFile;
		// No (or stale) selection — fall back to the first file so the view is
		// never blank while there are files to show.
		let fi = sel ? fileItems.findIndex((it) => it.file.path === sel) : -1;
		if (fi === -1) fi = 0;
		const active = fileItems[fi];
		const activeIdx = renderPlan.indexOf(active);
		const out: PlanItem[] = [];
		// Include the step header immediately preceding this file (tour view only),
		// for context; stop at the previous file so unrelated steps aren't pulled in.
		for (let i = activeIdx - 1; i >= 0; i--) {
			if (renderPlan[i].kind === 'file') break;
			if (renderPlan[i].kind === 'step') {
				out.push(renderPlan[i]);
				break;
			}
		}
		out.push(active);
		// Off-screen neighbours, primed and waiting. Order doesn't matter visually
		// (they're hidden); they trail the active file in the DOM.
		const prev = fileItems[fi - 1];
		const next = fileItems[fi + 1];
		if (prev) out.push({ ...prev, prerender: true });
		if (next) out.push({ ...next, prerender: true });
		return out;
	});

	// Index of the last file item, so it gets the min-height treatment that lets
	// its top scroll to the viewport top.
	const lastFileIndex = $derived(
		displayPlan.reduce((acc, it, i) => (it.kind === 'file' ? i : acc), -1)
	);

	let scrollContainer = $state<HTMLElement | null>(null);
	let observer = $state<IntersectionObserver | null>(null);
	let lastNonce = 0;

	// Shared observer for all file sections. Each section flips its `inView` flag
	// through a setter stashed on its root element when it enters the rootMargin
	// region — the section then triggers a fetch + render on first intersection.
	$effect(() => {
		if (!scrollContainer) return;
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const setter = (
						entry.target as HTMLElement & {
							__setInView?: (v: boolean) => void;
						}
					).__setInView;
					setter?.(entry.isIntersecting);
				}
			},
			{
				root: scrollContainer,
				// Render diffs a viewport ahead so they're ready by the time the user
				// scrolls there.
				rootMargin: '600px 0px',
				threshold: 0
			}
		);
		return () => observer?.disconnect();
	});

	// Pin a target to the top of the scroll container and keep it pinned while
	// the surrounding diffs settle. Jumping to a file/step/callout scrolls
	// instantly, but the sections that land in view then fetch + render their
	// diffs asynchronously — sections *above* the target grow and shove it out
	// from under the initial scroll, so it ends up off-position. We re-align
	// whenever the target drifts back off the top, until it has stayed put for a
	// sustained quiet period, and bail the moment the user scrolls or navigates
	// themselves.
	let cancelSettle: (() => void) | null = null;
	function pinToTop(target: HTMLElement): void {
		cancelSettle?.();
		const container = scrollContainer;
		if (!container) return;
		const align = (): void => target.scrollIntoView({ behavior: 'auto', block: 'start' });
		// How far the target's top sits from the container's top edge right now.
		// Watching this directly (rather than the container's total scrollHeight)
		// catches drift even when growth above the target is offset by a shrink
		// elsewhere and the net height is unchanged.
		const drift = (): number =>
			target.getBoundingClientRect().top - container.getBoundingClientRect().top;
		align();
		let raf = 0;
		// Keep correcting until the target has sat at the top undisturbed for a
		// sustained quiet period. On a big jump the lazy diff sections above the
		// target render asynchronously (Pierre, scheduled) and keep shoving it down
		// well after a short fixed deadline would have expired — which is why it
		// used to land mid-file. A generous hard cap still bounds the loop in case
		// something never settles.
		let stableSince = performance.now();
		const maxDeadline = stableSince + 4000;
		const stop = (): void => {
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			container.removeEventListener('wheel', stop);
			container.removeEventListener('touchstart', stop);
			window.removeEventListener('keydown', onNavKey);
			cancelSettle = null;
		};
		// Programmatic scrolls don't fire wheel/touchstart, so those only trigger on
		// the user taking over. Among keys, only genuine scroll/navigation ones
		// should cancel — typing in a composer shouldn't.
		const onNavKey = (e: KeyboardEvent): void => {
			if (
				e.key.startsWith('Arrow') ||
				e.key === 'PageUp' ||
				e.key === 'PageDown' ||
				e.key === 'Home' ||
				e.key === 'End' ||
				e.key === ' '
			) {
				stop();
			}
		};
		const tick = (): void => {
			const before = container.scrollTop;
			if (Math.abs(drift()) > 1) align();
			const now = performance.now();
			// Only a correction that actually moved the scroll counts as the target
			// being disturbed. If we're already at the top — or pinned as close as
			// the scroll range allows — the position holds and the quiet period
			// accrues toward stopping.
			if (Math.abs(container.scrollTop - before) > 1) stableSince = now;
			if (now - stableSince >= 500 || now >= maxDeadline) stop();
			else raf = requestAnimationFrame(tick);
		};
		container.addEventListener('wheel', stop, { passive: true });
		container.addEventListener('touchstart', stop, { passive: true });
		window.addEventListener('keydown', onNavKey);
		raf = requestAnimationFrame(tick);
		cancelSettle = stop;
	}

	// Honor scroll requests from the sidebar (file row, step header). Callout
	// requests are left to the owning DiffFileSection — the note lives inside the
	// diff, so the section brings itself into view and aligns to it.
	$effect(() => {
		const req = app.scrollRequest;
		if (!req || req.nonce === lastNonce || !scrollContainer) return;
		lastNonce = req.nonce;
		if (req.calloutId) return;
		const selector = req.stepId
			? `[data-step-id="${CSS.escape(req.stepId)}"]`
			: req.path
				? `[data-file-path="${CSS.escape(req.path)}"]`
				: null;
		if (!selector) return;
		const target = scrollContainer.querySelector(selector) as HTMLElement | null;
		if (target) pinToTop(target);
	});

	// Track which file section is currently being viewed so the sidebar can
	// highlight it. The "active" section is the one whose top has most recently
	// crossed the scroll container's top edge — i.e., the file whose sticky
	// header is pinned. Throttled to one update per animation frame.
	$effect(() => {
		// Read so the effect re-runs (and re-syncs) when the rendered list
		// changes — tab switch, search filter, refresh. The scroll/resize
		// listeners alone don't fire when the DOM is rebuilt at scrollTop 0.
		void visibleFiles;
		// Also re-run on collapse/expand: a toggle changes a section's height
		// but not the scroll container's own size, so the ResizeObserver below
		// never fires — yet which file is the first *expanded* one on screen can
		// change, so the active highlight must be recomputed.
		void app.collapsedFiles.size;
		if (!scrollContainer) return;
		const el = scrollContainer;
		let ticking = false;

		function updateActiveFile(): void {
			ticking = false;
			const containerRect = el.getBoundingClientRect();
			const containerTop = containerRect.top;
			const containerBottom = containerRect.bottom;
			// Skip the off-screen pre-rendered neighbours (single layout) — they sit
			// in the DOM but must never become the "active" file.
			const allSections = Array.from(
				el.querySelectorAll<HTMLElement>('section[data-file-path]')
			).filter((s) => !s.closest('.diff-wrap--prerender'));
			if (allSections.length === 0) return;
			// Prefer expanded sections: a collapsed file shows no content, so its
			// pinned sticky header must not claim "active" while an expanded file
			// below it is the one actually on screen. When everything is collapsed
			// there's nothing to read, so fall back to all sections so the sidebar
			// still tracks the pinned header.
			const expandedSections = allSections.filter((s) => s.dataset.collapsed !== 'true');
			const sections = expandedSections.length > 0 ? expandedSections : allSections;
			let active: string | null = null;
			let activeRelTop = -Infinity;
			for (const section of sections) {
				const relTop = section.getBoundingClientRect().top - containerTop;
				// Section whose top is at or just above the viewport top, picking the
				// one closest to 0 (i.e., the one most recently scrolled into).
				if (relTop <= 1 && relTop > activeRelTop) {
					activeRelTop = relTop;
					active = section.getAttribute('data-file-path');
				}
			}
			// None has crossed the top edge yet — e.g. collapsed headers occupy the
			// top while the first expanded file sits just below them. Anchor to the
			// first change visible on the page (the topmost partially-visible section),
			// which also covers being scrolled above all sections.
			if (!active) {
				for (const section of sections) {
					const rect = section.getBoundingClientRect();
					if (rect.bottom > containerTop && rect.top < containerBottom) {
						active = section.getAttribute('data-file-path');
						break;
					}
				}
			}
			// Still nothing visible — anchor to the first section.
			if (!active) active = sections[0].getAttribute('data-file-path');
			if (active) actions.setActiveFromScroll(active);
		}

		function schedule(): void {
			if (ticking) return;
			ticking = true;
			requestAnimationFrame(updateActiveFile);
		}

		el.addEventListener('scroll', schedule, { passive: true });
		const ro = new ResizeObserver(schedule);
		ro.observe(el);
		schedule();
		return () => {
			el.removeEventListener('scroll', schedule);
			ro.disconnect();
		};
	});

	// Register the scroll container as the search root so the find controller
	// walks only the diff content (not the sidebar, headers, etc).
	$effect(() => {
		setFindRoot(scrollContainer);
		return () => setFindRoot(null);
	});

	// App-wide find shortcuts, mounted on <svelte:window> via the shortcut
	// action (below) so they fire regardless of where focus currently is:
	//   • Ctrl/Cmd+F opens (or re-focuses) the find bar.
	//   • Escape closes it. The bar's input handles Esc while focused, but once
	//     focus leaves the input (pressing Enter to jump to a match, clicking a
	//     nav button, or clicking into the diff) that local handler never fires,
	//     so this catches it everywhere. preventDefault is opt-out here so a bare
	//     Escape still reaches dialogs/menus when find isn't open.
	const findShortcuts: ShortcutOptions[] = [
		{
			key: 'f',
			ctrl: true,
			callback: () => {
				if (app.activeRepo) openFind();
			}
		},
		{
			key: 'Escape',
			preventDefault: false,
			callback: (e) => {
				if (!find.open) return;
				e.preventDefault();
				closeFind();
			}
		}
	];

	onDestroy(() => {
		observer?.disconnect();
		cancelSettle?.();
		closeFind();
	});
</script>

<svelte:window use:shortcut={findShortcuts} />

<section class="relative flex h-full min-w-0 flex-1 flex-col">
	<FindBar />
	<div bind:this={scrollContainer} class="flex-1 overflow-auto">
		{#if app.changedFiles.length === 0}
			{#if app.loading.files}
				<div class="grid h-full place-items-center text-muted-foreground">
					<div class="flex flex-col items-center gap-2 text-center">
						<Inbox class="size-8 opacity-40" />
						<p class="text-sm">Loading…</p>
					</div>
				</div>
			{:else if app.contextTab === 'unstaged'}
				<!-- Working tree is clean — offer repo-level next steps. -->
				<NoChanges />
			{:else}
				<div class="grid h-full place-items-center text-muted-foreground">
					<div class="flex flex-col items-center gap-2 text-center">
						<Inbox class="size-8 opacity-40" />
						<p class="text-sm">
							{app.contextTab === 'branch' ? 'No changes on this branch' : 'No changes'}
						</p>
					</div>
				</div>
			{/if}
		{:else if visibleFiles.length === 0}
			<div class="grid h-full place-items-center text-muted-foreground">
				<div class="flex flex-col items-center gap-2 text-center">
					<Inbox class="size-8 opacity-40" />
					<p class="text-sm">No files match "{app.fileSearchQuery}"</p>
				</div>
			</div>
		{/if}

		{#each displayPlan as item, i (item.kind === 'step' ? `step:${item.id}` : `file:${item.file.path}`)}
			{#if item.kind === 'step'}
				<SessionStepHeader
					id={item.id}
					title={item.title}
					body={item.body}
					index={item.index}
					total={item.total}
				/>
			{:else}
				<!-- Keyed reuse means a pre-rendered neighbour keeps its rendered diff
				     when it becomes the selected file: only this wrapper's class flips
				     from off-screen back to display:contents. -->
				<div
					class={['diff-wrap', item.prerender && 'diff-wrap--prerender']}
					aria-hidden={item.prerender}
				>
					<DiffFileSection
						file={item.file}
						{observer}
						isLast={!item.prerender && (app.diffLayout === 'single' ? true : i === lastFileIndex)}
						eager={app.diffLayout === 'single'}
					/>
				</div>
			{/if}
		{/each}
	</div>
</section>

<style>
	/* The wrapper is layout-transparent by default so a file section behaves as a
	   direct child of the scroll container (sticky headers, the last file's
	   min-height all resolve against it, exactly as before). */
	.diff-wrap {
		display: contents;
	}
	/* Off-screen pre-render: keep the section laid out at full width so Pierre
	   measures the diff correctly, but collapse it to zero height and hide it so
	   it neither shows nor adds to the scroll height. (visibility:hidden — not
	   display:none — because Pierre measures 0×0 inside a display:none subtree and
	   renders a blank diff.) Navigating here flips the class off and the
	   already-rendered diff appears instantly. */
	.diff-wrap--prerender {
		display: block;
		height: 0;
		overflow: hidden;
		visibility: hidden;
		pointer-events: none;
	}
</style>
