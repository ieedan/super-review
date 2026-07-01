<script lang="ts">
	// Compact select for settings rows: a trigger showing the current value, opening
	// a menu of options. Built on DropdownMenu so it matches the rest of the app, and
	// used everywhere a setting is a single choice (theme, diff view, behavior, ...)
	// so every settings tab reads as one consistent list of switch / select / input.
	import Check from '@lucide/svelte/icons/check';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import * as DropdownMenu from './ui/dropdown-menu';
	import { buttonVariants } from './ui/button';
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

	const selected = $derived(options.find((o) => o.value === value));
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		aria-label={ariaLabel}
		class={cn(
			buttonVariants({ variant: 'outline', size: 'sm' }),
			'min-w-[180px] justify-between font-normal',
			className
		)}
	>
		<span class="flex min-w-0 items-center gap-2">
			{#if selected?.swatch}
				<span
					class="size-3 shrink-0 rounded-full border border-black/10"
					style="background: {selected.swatch}"
				></span>
			{/if}
			<span class="truncate">{selected?.label ?? placeholder}</span>
		</span>
		<ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground opacity-70" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="max-h-[280px] min-w-[180px]">
		{#each options as opt (opt.value)}
			<DropdownMenu.Item class="gap-2" disabled={opt.disabled} onSelect={() => onChange(opt.value)}>
				<Check class={cn('size-3.5 shrink-0', value === opt.value ? 'opacity-100' : 'opacity-0')} />
				{#if opt.swatch}
					<span
						class="size-3 shrink-0 rounded-full border border-black/10"
						style="background: {opt.swatch}"
					></span>
				{/if}
				<span class="flex-1 truncate">{opt.label}</span>
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
