<script lang="ts">
	// The sparkle on the "Add a changeset?" notice: hand the branch to the agent
	// and let it write the changesets. Same glyph and shimmer as the commit-box
	// sparkle, sized for the notice row. One control, no popover; the prompt it
	// runs with lives in Settings → Prompts.
	import { actions, app, effectiveCommitMessageHarness } from '@super-review/ui/store.svelte';
	import { cn } from '@super-review/ui/utils';
	import { harnessLabel } from '@super-review/core/types';

	let { disabled = false }: { disabled?: boolean } = $props();

	// Null until detection finishes, and whenever no supported CLI is installed:
	// there is nothing to generate with, so the sparkle stays hidden.
	const generateHarness = $derived(effectiveCommitMessageHarness());
	const label = $derived(
		generateHarness ? `Generate a changeset with ${harnessLabel(generateHarness)}` : ''
	);
</script>

{#if generateHarness}
	<button
		type="button"
		class={cn(
			'flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
		)}
		disabled={disabled || app.changesetGenerating}
		title={label}
		aria-label={label}
		onclick={() => void actions.generateChangeset()}
	>
		<!-- No running state here: once a run starts the whole notice becomes the
		     shimmering "Generating changeset…" row, this button included. -->
		<span class="text-[15px] leading-none" aria-hidden="true">✦</span>
	</button>
{/if}
