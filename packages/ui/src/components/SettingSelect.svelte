<script lang="ts">
	// Compact select for settings rows: a trigger showing the current value, opening
	// a menu of options. Built on the high-level Select so it matches the rest of the
	// app, and used everywhere a setting is a single choice (theme, diff view,
	// behavior, ...) so every settings tab reads as one consistent list of switch /
	// select / input.
	import { Select } from './ui/select';
	import { cn } from '@super-review/ui/utils';

	type Option = { value: string; label: string; disabled?: boolean; swatch?: string };

	let {
		options,
		value,
		onChange,
		ariaLabel,
		placeholder = 'Select…',
		class: className
	}: {
		options: Option[];
		value: string;
		onChange: (value: string) => void;
		ariaLabel?: string;
		placeholder?: string;
		class?: string;
	} = $props();

	const items = $derived(
		options.map((o) => ({ value: o.value, label: o.label, swatch: o.swatch }))
	);
</script>

<Select
	type="single"
	{value}
	onValueChange={onChange}
	{items}
	{placeholder}
	{ariaLabel}
	align="end"
	size="sm"
	class={cn('min-w-[180px]', className)}
>
	{#snippet item({ item })}
		{#if item.swatch}
			<span
				class="size-3 shrink-0 rounded-full border border-black/10"
				style="background: {item.swatch}"
			></span>
		{/if}
		{item.label}
	{/snippet}
</Select>
