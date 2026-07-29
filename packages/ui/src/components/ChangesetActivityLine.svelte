<script lang="ts">
	// The line under "Generating changeset…" that says what the agent is doing
	// right now. Each new status rolls the previous one up out of view, so the row
	// reads as a run in progress rather than a value being replaced.
	//
	// Same mechanism as the commit box's waiting line (CommitMessageWaiting): a
	// one-line window with the statuses stacked inside it, moved up by whole lines.
	// The difference is that these arrive as the agent works instead of coming from
	// a fixed list, so the stack grows as the run goes.
	import { untrack } from 'svelte';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import { cn } from '@super-review/ui/utils';

	let {
		status,
		placeholder = 'Reading the branch'
	}: {
		/** The agent's latest reported activity. Empty until its first tool call. */
		status: string;
		/** Shown until then, so the row is never a line short. */
		placeholder?: string;
	} = $props();

	const animations = useAnimations();

	// Only the tail is kept: this is a status line, not a transcript. Dropping the
	// oldest as a new one arrives leaves the visible line exactly where it was,
	// since the window always sits on the last entry.
	const KEEP = 12;

	let lines = $state<string[]>([]);
	// Before the first status lands there is nothing to roll, so the placeholder
	// stands in without being part of the stack.
	const shown = $derived(lines.length > 0 ? lines : [placeholder]);

	$effect(() => {
		const next = status.trim();
		if (!next) return;
		// Reading `lines` here would make this effect depend on its own write.
		untrack(() => {
			if (lines[lines.length - 1] === next) return;
			// Seed the placeholder as the first entry so the first real status rolls
			// up from it rather than snapping into place.
			if (lines.length === 0) lines.push(placeholder);
			lines.push(next);
			if (lines.length > KEEP) lines.shift();
		});
	});
</script>

<!-- One line tall, with the stack inside moved up so the newest sits in the
     window. Steps in `lh` rather than percentages: a percentage translate is
     relative to the stack's own height, which walks the whole list off screen in
     one go. -->
<span class="block h-[1lh] overflow-hidden">
	<span
		class={cn(
			'block',
			animations.accentsEnabled &&
				'transition-transform duration-400 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none'
		)}
		style="transform: translateY(calc({shown.length - 1} * -1lh))"
	>
		{#each shown as line, i (`${i}:${line}`)}
			<span class="block h-[1lh] truncate">{line}</span>
		{/each}
	</span>
</span>
