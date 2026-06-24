<!--
	A Sonner-style stack of cards, front-first (index 0 is the fully-visible front
	card at the bottom; the stack grows upward). Vendored from svelte-sonner's
	Toaster.svelte (https://github.com/wobsoriano/svelte-sonner) and adapted from
	its imperative `toast()` store to our prop-driven model: the caller passes
	`items` and a `card` snippet, and the stack owns layout, hover-expand and the
	exit animation.

	Two placements:
	  fixed  — a corner overlay (used for error toasts)
	  inline — flows in the document and reserves its collapsed height (used for
	           the commit-box notices)

	Dismissal mirrors svelte-sonner's `deleteToast`: the card is marked `removing`,
	frozen at its current offset, and dropped from the layout so survivors slide
	smoothly into place; only after EXIT_MS (the exit-animation length) do we call
	`onDismiss` so the caller can remove it from `items`.
-->
<script lang="ts" generics="T extends { id: string }">
	import type { Snippet } from 'svelte';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import StackItem from './StackItem.svelte';

	let {
		items,
		card,
		onDismiss,
		gap = 14,
		visibleToasts = 3,
		fixed = false
	}: {
		/** Front-first: index 0 is the fully-visible front card. */
		items: T[];
		card: Snippet<[T, { dismiss: () => void }]>;
		/** Called once a card has finished animating out. */
		onDismiss?: (item: T) => void;
		/** Vertical gap between fanned-out cards (px). Also the collapsed peek. */
		gap?: number;
		/** How many cards stay visible before the rest fade out behind the stack. */
		visibleToasts?: number;
		/** Render as a fixed bottom-right overlay instead of inline in the flow. */
		fixed?: boolean;
	} = $props();

	// Length of the longest exit transition in StackItem; we drop the card from the
	// layout this long after dismiss so it's fully faded before it unmounts.
	const EXIT_MS = 200;
	// Height assumed before a card has been measured, so offsets don't start at 0.
	const FALLBACK = 48;

	let expanded = $state(false);
	// True while the pointer is pressed inside the stack, so a click (e.g. the
	// close button) doesn't let a momentary leave collapse the stack.
	let interacting = $state(false);
	let listEl: HTMLOListElement | undefined;

	const heights = new SvelteMap<string, number>();
	const removing = new SvelteSet<string>();
	// Frozen layout captured at dismiss time so an exiting card stays put while the
	// survivors reflow around it.
	const frozenOffset = new SvelteMap<string, number>();
	const frozenFront = new SvelteMap<string, boolean>();
	const frozenBefore = new SvelteMap<string, number>();

	function reportHeight(id: string, h: number): void {
		heights.set(id, h);
	}

	// Cards that still count toward layout — everything not mid-exit.
	const live = $derived(items.filter((i) => !removing.has(i.id)));
	const rankOf = (id: string): number => live.findIndex((i) => i.id === id);
	const h = (id: string): number => heights.get(id) ?? FALLBACK;

	// Cumulative height (+gap) of every live card in front of rank `r`.
	function offsetAt(r: number): number {
		let off = 0;
		for (let j = 0; j < r; j++) off += h(live[j].id);
		return Math.round(r * gap + off);
	}

	const frontHeight = $derived(live.length ? h(live[0].id) : 0);
	const behind = $derived(Math.min(Math.max(live.length - 1, 0), visibleToasts - 1));
	// Collapsed footprint: front card plus a peek sliver per card stacked behind it.
	const collapsedHeight = $derived(frontHeight + behind * gap);

	function dismiss(item: T): void {
		const id = item.id;
		if (removing.has(id)) return;
		const r = rankOf(id);
		frozenOffset.set(id, offsetAt(Math.max(r, 0)));
		frozenFront.set(id, r === 0);
		frozenBefore.set(id, Math.max(r, 0));
		removing.add(id);
		setTimeout(() => {
			removing.delete(id);
			frozenOffset.delete(id);
			frozenFront.delete(id);
			frozenBefore.delete(id);
			heights.delete(id);
			onDismiss?.(item);
		}, EXIT_MS);
	}

	// Nothing to fan out once a single card remains, so keep it collapsed (parity
	// with svelte-sonner) — avoids a lone card sitting in the "expanded" slot.
	$effect(() => {
		if (live.length <= 1) expanded = false;
	});

	function onLeave(): void {
		if (!interacting) expanded = false;
	}
	function onPointerUp(): void {
		interacting = false;
	}
	function onFocusOut(e: FocusEvent): void {
		const next = e.relatedTarget as Node | null;
		if (!next || !listEl?.contains(next)) expanded = false;
	}
</script>

<svelte:window onpointerup={onPointerUp} />

<ol
	bind:this={listEl}
	class:fixed
	style:--gap={`${gap}px`}
	style:--front-toast-height={`${frontHeight}px`}
	style:height={`${collapsedHeight}px`}
	onmouseenter={() => (expanded = true)}
	onmouseleave={onLeave}
	onpointerdown={() => (interacting = true)}
	onfocusin={() => (expanded = true)}
	onfocusout={onFocusOut}
>
	{#each items as item, i (item.id)}
		{@const isRemoving = removing.has(item.id)}
		{@const r = rankOf(item.id)}
		<StackItem
			{item}
			{card}
			dismiss={() => dismiss(item)}
			front={isRemoving ? (frozenFront.get(item.id) ?? false) : r === 0}
			{expanded}
			removed={isRemoving}
			visible={isRemoving ? true : r > -1 && r < visibleToasts}
			toastsBefore={isRemoving ? (frozenBefore.get(item.id) ?? 0) : Math.max(r, 0)}
			offset={isRemoving ? (frozenOffset.get(item.id) ?? 0) : offsetAt(Math.max(r, 0))}
			zIndex={items.length - i}
			{reportHeight}
		/>
	{/each}
</ol>

<style>
	ol {
		position: relative;
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ol.fixed {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		width: 100%;
		max-width: 24rem;
		z-index: 50;
	}
</style>
