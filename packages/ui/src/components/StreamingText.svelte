<script lang="ts">
	// Text that arrives a token at a time, rendered so each new word fades in as
	// it lands instead of the whole block re-rendering silently.
	//
	// Words are keyed by position, so a growing string only ever appends spans:
	// the words already on screen keep their DOM node (and never re-run their
	// animation), and the last word grows in place until the next space arrives.
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import { cn } from '@super-review/ui/utils';

	let { text = '', class: className }: { text?: string; class?: string } = $props();

	const animations = useAnimations();

	// Split on whitespace but keep it: the separators stay plain text nodes so
	// wrapping and blank lines behave exactly as they would without the spans
	// (an inline-block cannot be broken across lines). Empty text renders nothing
	// rather than one empty span.
	const tokens = $derived(text ? text.split(/(\s+)/) : []);
</script>

<span class={cn('whitespace-pre-wrap', className)}
	>{#each tokens as token, i (i)}{#if /^\s+$/.test(token)}{token}{:else if animations.accentsEnabled}<span
				class="inline-block animate-stream-token">{token}</span
			>{:else}{token}{/if}{/each}</span
>
