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

	let { paths, class: className = 'h-[440px]' }: { paths?: string[]; class?: string } = $props();

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
