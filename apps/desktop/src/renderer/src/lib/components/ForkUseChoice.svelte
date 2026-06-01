<script lang="ts">
	// The two-option fork-use radio (GitHub Desktop's `forkContributionTarget`),
	// shared by the fork-creation dialog and the Fork Behavior settings pane.
	// 'parent' = contribute to the upstream; 'self' = work the fork standalone.
	import { RadioGroup, RadioGroupItem } from './ui/radio-group';

	let {
		value = $bindable('parent'),
		parentLabel = null,
		disabled = false,
		idPrefix = 'fork-use'
	}: {
		value?: 'parent' | 'self';
		parentLabel?: string | null;
		disabled?: boolean;
		idPrefix?: string;
	} = $props();
</script>

<RadioGroup bind:value {disabled} class="gap-2">
	{@render optionCard(
		`${idPrefix}-parent`,
		'parent',
		'To contribute to the parent project',
		parentLabel
			? `Pull requests will target ${parentLabel}.`
			: 'Pull requests will target the parent repository.'
	)}
	{@render optionCard(
		`${idPrefix}-self`,
		'self',
		'For my own purposes',
		'Work on the fork independently; pull requests target your fork.'
	)}
</RadioGroup>

{#snippet optionCard(id: string, optValue: string, title: string, description: string)}
	<label
		for={id}
		class="flex cursor-pointer flex-col rounded-lg border border-border leading-snug transition-colors has-[[data-state=checked]]:border-primary/30 has-[[data-state=checked]]:bg-primary/5 dark:has-[[data-state=checked]]:border-primary/20 dark:has-[[data-state=checked]]:bg-primary/10"
	>
		<div class="flex w-full flex-row items-center gap-3 p-3">
			<div class="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
				<span class="truncate text-sm leading-snug font-medium">{title}</span>
				<span class="text-xs leading-snug text-muted-foreground">{description}</span>
			</div>
			<RadioGroupItem {id} value={optValue} />
		</div>
	</label>
{/snippet}
