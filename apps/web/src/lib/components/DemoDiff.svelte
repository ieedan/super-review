<script lang="ts">
	// The real desktop DiffFileSection(s), booted against the mock store. Interactive:
	// the real file header (Mark seen / collapse / Diff·Raw), and clicking a line opens
	// a comment composer. `paths` scopes + orders which mock files render.
	//
	// "Mark seen" advances to the next file in the desktop app — that lives in DiffView,
	// which we don't use here, so we replicate it: when a file in this card is marked
	// seen, smooth-scroll the next unreviewed file to the top of the card (never the
	// window).
	import { bootDemo } from '$lib/demo/boot';
	import DiffFileSection from '@super-review/ui/components/DiffFileSection.svelte';
	import { app } from '@super-review/ui/store.svelte';
	import type { ChangedFile } from '@super-review/core/types';

	let {
		paths,
		class: className = 'h-[440px]',
		focusCommentId
	}: { paths?: string[]; class?: string; focusCommentId?: string } = $props();

	bootDemo();

	const files = $derived.by<ChangedFile[]>(() => {
		const all = app.changedFiles as ChangedFile[];
		if (!paths) return all;
		const byPath = new Map(all.map((f) => [f.path, f]));
		return paths.map((p) => byPath.get(p)).filter((f): f is ChangedFile => !!f);
	});

	let scroller = $state<HTMLElement | null>(null);

	function scrollToFile(path: string): void {
		const el = scroller?.querySelector<HTMLElement>(`[data-file-path="${path}"]`);
		if (!el || !scroller) return;
		const top =
			scroller.scrollTop + (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
		scroller.scrollTo({ top, behavior: 'auto' });
	}

	// Pierre slots comment annotations into the diff's light DOM, so a plain
	// querySelector from the card reaches them.
	function findCommentEl(id: string): HTMLElement | null {
		return scroller?.querySelector<HTMLElement>(`[data-comment-id="${id}"]`) ?? null;
	}

	// Center the comment's thread within the card, returning true once the comment
	// exists (so the caller knows the center actually landed). Card-only math —
	// never touches the window scroll.
	function centerComment(id: string): boolean {
		const el = findCommentEl(id);
		if (!el || !scroller) return false;
		const top =
			scroller.scrollTop +
			(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) -
			(scroller.clientHeight - el.offsetHeight) / 2;
		scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
		return true;
	}

	// Open the card already scrolled to a comment thread (image 1) instead of the
	// file top (image 2). The diff mounts async and re-renders once syntax
	// highlighting lands (shifting row heights), and in some cases doesn't render
	// until the card nears the viewport — so drive this off a MutationObserver that
	// re-centers on every change, rather than a one-shot timer that could fire
	// before the diff exists. Once the comment first appears we keep re-centering
	// for a short grace period (to ride out the highlight re-render) and then
	// disconnect. Bails the moment the user scrolls.
	function focusComment(id: string): () => void {
		const host = scroller;
		if (!host) return () => {};
		let raf = 0;
		let lifetime = 0;
		const observer = new MutationObserver(() => recenter());
		const stop = (): void => {
			if (raf) cancelAnimationFrame(raf);
			clearTimeout(lifetime);
			observer.disconnect();
			host.removeEventListener('wheel', stop);
			host.removeEventListener('touchstart', stop);
		};
		const recenter = (): void => {
			if (raf) return; // coalesce a burst of mutations into one frame
			raf = requestAnimationFrame(() => {
				raf = 0;
				// Once the comment first renders, give it a brief grace period to
				// re-center through the syntax-highlight re-render, then disconnect so
				// later edits/composers don't yank the scroll.
				if (centerComment(id) && !lifetime) lifetime = window.setTimeout(stop, 1200);
			});
		};
		host.addEventListener('wheel', stop, { passive: true });
		host.addEventListener('touchstart', stop, { passive: true });
		observer.observe(host, { childList: true, subtree: true });
		recenter();
		return stop;
	}

	$effect(() => {
		if (focusCommentId) return focusComment(focusCommentId);
	});

	// Watch this card's files for a fresh "seen" mark, then scroll to the next
	// unreviewed one (wrapping to the first if none remain below). The first run
	// just records the baseline so the pre-seeded seen file doesn't auto-scroll.
	let seenBaseline: Set<string> | null = null;
	$effect(() => {
		const seenHere = files.filter((f) => app.seenFiles.has(f.path)).map((f) => f.path);
		if (seenBaseline === null) {
			seenBaseline = new Set(seenHere);
			return;
		}
		const justSeen = seenHere.find((p) => !seenBaseline!.has(p));
		seenBaseline = new Set(seenHere);
		if (!justSeen) return;
		const idx = files.findIndex((f) => f.path === justSeen);
		const next =
			files.slice(idx + 1).find((f) => !app.seenFiles.has(f.path)) ??
			files.find((f) => !app.seenFiles.has(f.path));
		if (!next) return;
		// Two frames: let the just-seen file collapse and the layout settle first.
		requestAnimationFrame(() => requestAnimationFrame(() => scrollToFile(next.path)));
	});
</script>

<div
	bind:this={scroller}
	class="{className} scroll-auto overscroll-contain overflow-auto rounded-xl border border-border bg-background"
>
	{#each files as file, i (file.path)}
		<DiffFileSection {file} observer={null} eager isLast={i === files.length - 1} />
	{/each}
</div>
