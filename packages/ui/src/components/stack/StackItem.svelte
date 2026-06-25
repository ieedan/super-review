<!--
	One item in a Stack. Vendored from svelte-sonner's Toast.svelte positioning
	model (https://github.com/wobsoriano/svelte-sonner), trimmed to what we need:
	no swipe, no auto-dismiss timers, no promise/loader/action machinery. The card
	contents are supplied by the parent via a snippet.

	Position is driven entirely by data-attributes + CSS custom properties so the
	transforms live in CSS (see the <style> block):
	  --gap, --front-toast-height  inherited from the Stack container
	  --toasts-before, --offset    set per item from measured heights
	  data-mounted / data-expanded / data-front / data-removed / data-visible
	The `::after` bridge on an expanded item is svelte-sonner's trick that keeps
	the pointer "inside" the stack while moving between fanned-out cards, so the
	stack never collapses mid-hover.
-->
<script lang="ts" generics="T extends { id: string }">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';

	let {
		item,
		card,
		dismiss,
		front,
		expanded,
		removed,
		visible,
		toastsBefore,
		offset,
		zIndex,
		reportHeight
	}: {
		item: T;
		card: Snippet<[T, { dismiss: () => void }]>;
		dismiss: () => void;
		/** This item is the fully-visible front card. */
		front: boolean;
		/** The whole stack is fanned out. */
		expanded: boolean;
		/** Mid-exit: animate out, then the parent drops it. */
		removed: boolean;
		/** Within the visible window (older ones past the limit fade out). */
		visible: boolean;
		/** How many cards sit in front of this one (drives lift + scale). */
		toastsBefore: number;
		/** Expanded vertical offset from the anchor, in px. */
		offset: number;
		zIndex: number;
		reportHeight: (id: string, height: number) => void;
	} = $props();

	// Flipped on after the first paint so the entrance transition plays from the
	// off-screen `--y` rather than snapping into place.
	let mounted = $state(false);
	// Natural (untransformed) height of the card, measured from the inner wrapper
	// which is never height-constrained, then reported up so the parent can lay out
	// the expanded offsets.
	let innerHeight = $state(0);

	onMount(() => {
		const raf = requestAnimationFrame(() => (mounted = true));
		return () => cancelAnimationFrame(raf);
	});

	$effect(() => {
		if (innerHeight > 0) reportHeight(item.id, innerHeight);
	});
</script>

<li
	data-stack-item
	data-mounted={mounted}
	data-front={front}
	data-expanded={expanded}
	data-removed={removed}
	data-visible={visible}
	style:--toasts-before={toastsBefore}
	style:--offset={`${offset}px`}
	style:z-index={zIndex}
>
	<div class="inner" bind:clientHeight={innerHeight}>
		{@render card(item, { dismiss })}
	</div>
</li>

<style>
	li[data-stack-item] {
		--lift: -1;
		--lift-amount: calc(var(--lift) * var(--gap));
		--y: translateY(100%);
		position: absolute;
		inset-inline: 0;
		bottom: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		opacity: 0;
		transform: var(--y);
		transform-origin: bottom center;
		transition:
			transform 400ms ease,
			opacity 400ms ease;
		will-change: transform, opacity;
	}

	.inner {
		width: 100%;
	}

	/* Entrance: slide up from below + fade in. */
	li[data-stack-item][data-mounted='true'] {
		--y: translateY(0);
		opacity: 1;
	}

	/* Collapsed cards behind the front one: lifted by a gap each and scaled down. */
	li[data-stack-item][data-expanded='false'][data-front='false'] {
		--y: translateY(calc(var(--lift-amount) * var(--toasts-before)))
			scale(calc(1 - var(--toasts-before) * 0.05));
	}

	/* Expanded: fan out to the cumulative offset. */
	li[data-stack-item][data-mounted='true'][data-expanded='true'] {
		--y: translateY(calc(var(--lift) * var(--offset)));
	}

	/* Past the visible window. */
	li[data-stack-item][data-visible='false'] {
		opacity: 0;
		pointer-events: none;
	}

	/* Invisible bridge filling the gap above an expanded card so the pointer never
	   falls between cards (which would read as a mouse-leave and collapse it). */
	li[data-stack-item][data-expanded='true']::after {
		content: '';
		position: absolute;
		inset-inline: 0;
		bottom: 100%;
		height: calc(var(--gap) + 1px);
	}

	/* Exit animations. Opacity is 200ms to match the parent's unmount delay so the
	   card is fully faded by the time it's dropped; the transform can run longer. */
	li[data-stack-item][data-removed='true'][data-front='true'] {
		--y: translateY(calc(var(--lift) * -100%));
		opacity: 0;
		transition:
			transform 400ms ease,
			opacity 200ms ease;
	}

	li[data-stack-item][data-removed='true'][data-front='false'][data-expanded='true'] {
		--y: translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));
		opacity: 0;
		transition:
			transform 400ms ease,
			opacity 200ms ease;
	}

	li[data-stack-item][data-removed='true'][data-front='false'][data-expanded='false'] {
		--y: translateY(40%);
		opacity: 0;
		transition:
			transform 500ms ease,
			opacity 200ms ease;
	}

	@media (prefers-reduced-motion: reduce) {
		li[data-stack-item] {
			transition: opacity 200ms ease;
		}
	}
</style>
