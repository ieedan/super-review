<script lang="ts" generics="T extends { id: string }">
	// Arranges notices into a Sonner-style stack above the commit box. Collapsed,
	// only the front card (index 0) is fully visible; the rest peek out behind it,
	// each nudged up a little and scaled down. Hovering (or focusing into) the
	// stack expands it into a full vertical column so every card is readable and
	// individually dismissable, then it collapses again on leave.
	//
	// The front card sits at the bottom, nearest the commit box, and the stack
	// grows upward. Collapsed it reserves just enough height for the front card
	// plus the peeking slivers; expanded, the extra cards overflow upward and
	// overlay the content above (like Sonner overlays the page) rather than
	// pushing the commit box down.
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';

	let {
		items,
		card,
		gap = 8,
		peek = 10,
		maxBehind = 2
	}: {
		/** Front-first: index 0 is the fully-visible card nearest the commit box. */
		items: T[];
		/** Renders one card's contents. */
		card: Snippet<[T]>;
		/** Vertical gap between cards when expanded (px). */
		gap?: number;
		/** How far each card peeks above the one in front of it when collapsed (px). */
		peek?: number;
		/** How many cards behind the front one stay visible when collapsed. */
		maxBehind?: number;
	} = $props();

	let expanded = $state(false);
	let stackEl: HTMLDivElement | undefined;

	// Natural (pre-transform) heights per id, measured from the DOM. Falls back to
	// an estimate until the first measurement lands so there's no initial jump.
	const FALLBACK = 34;
	let heights = $state<Record<string, number>>({});
	const h = (id: string): number => heights[id] ?? FALLBACK;

	const frontHeight = $derived(items.length ? h(items[0].id) : 0);
	const behindCount = $derived(Math.min(items.length - 1, maxBehind));

	// In-flow footprint: the front card plus a peek sliver per visible card behind
	// it, so the collapsed stack doesn't overlap the content above.
	const collapsedHeight = $derived(frontHeight + behindCount * peek);

	// Distance from the container's bottom edge to card `i`'s bottom edge when the
	// stack is expanded — the cumulative height (+gap) of every card in front of it.
	function expandedOffset(i: number): number {
		let off = 0;
		for (let j = 0; j < i; j++) off += h(items[j].id) + gap;
		return off;
	}

	function transform(i: number): string {
		if (expanded) return `translateY(-${expandedOffset(i)}px) scale(1)`;
		const scale = Math.max(0, 1 - i * 0.05);
		return `translateY(-${i * peek}px) scale(${scale})`;
	}

	// Collapsed cards beyond the peek limit are hidden; everything shows expanded.
	const cardOpacity = (i: number): number => (expanded || i <= maxBehind ? 1 : 0);

	function onFocusOut(e: FocusEvent): void {
		const next = e.relatedTarget as Node | null;
		if (!next || !stackEl?.contains(next)) expanded = false;
	}
</script>

<div
	bind:this={stackEl}
	role="group"
	class="relative mx-2 mt-2 mb-2"
	style:height={`${collapsedHeight}px`}
	onpointerenter={() => (expanded = true)}
	onpointerleave={() => (expanded = false)}
	onfocusin={() => (expanded = true)}
	onfocusout={onFocusOut}
>
	{#each items as item, i (item.id)}
		<div
			class="absolute inset-x-0 bottom-0 origin-bottom transition-all duration-300 ease-out will-change-transform"
			style:transform={transform(i)}
			style:opacity={cardOpacity(i)}
			style:z-index={items.length - i}
			style:pointer-events={cardOpacity(i) === 0 ? 'none' : 'auto'}
			transition:fade={{ duration: 150 }}
			bind:clientHeight={
				() => heights[item.id] ?? 0, (v) => (heights = { ...heights, [item.id]: v })
			}
		>
			{@render card(item)}
		</div>
	{/each}
</div>
