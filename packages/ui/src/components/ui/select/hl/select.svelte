<script lang="ts" generics="Item extends { label: string; value: string; disabled?: boolean }">
	// High-level Select: items in, ready-made trigger + padded content out.
	// Prefer this over composing Root/Trigger/Content/Item by hand for ordinary
	// single-choice fields. Custom item rendering goes through the `item` snippet.
	import type { Snippet } from 'svelte';
	import type { Select as SelectPrimitive } from 'bits-ui';
	import { Select as SelectPrimitiveNs } from 'bits-ui';
	import { cn } from '@super-review/ui/utils.js';
	import Trigger from '../select-trigger.svelte';
	import Value from '../select-value.svelte';
	import Content from '../select-content.svelte';
	import Item from '../select-item.svelte';
	import Group from '../select-group.svelte';
	import GroupHeading from '../select-group-heading.svelte';
	import Separator from '../select-separator.svelte';

	const Root = SelectPrimitiveNs.Root;

	/**
	 * Items can be supplied in three shapes:
	 *
	 *   - `Item[]` — flat list, no separators (the default).
	 *   - `Item[][]` — array of groups, rendered with a separator between
	 *     groups and no group headings.
	 *   - `Record<string, Item[]>` — keyed groups; each key becomes the
	 *     group heading and groups are separator-divided.
	 */
	type Items = Item[] | Item[][] | Record<string, Item[]>;

	type Props = {
		items: Items;
		placeholder: string;
		disabled?: boolean;
		size?: 'sm' | 'default';
		item?: Snippet<[{ item: Item }]>;
		class?: string;
		contentClass?: string;
		sideOffset?: SelectPrimitive.ContentProps['sideOffset'];
		align?: SelectPrimitive.ContentProps['align'];
		side?: SelectPrimitive.ContentProps['side'];
		/** Forwarded to the trigger button for accessibility. */
		ariaLabel?: string;
		/** Forwarded to the trigger button (e.g. disabled-state hint). */
		title?: string;
	} & (
		| {
				type: 'single';
				value: NoInfer<Item['value']>;
				onValueChange?: (value: NoInfer<Item['value']>) => void;
		  }
		| {
				type: 'multiple';
				value: NoInfer<Item['value']>[];
				onValueChange?: (value: NoInfer<Item['value']>[]) => void;
		  }
	);

	let {
		items,
		value = $bindable(),
		type,
		placeholder,
		item: itemSnippet,
		disabled,
		size = 'default',
		class: className,
		contentClass,
		align = 'start',
		side = 'bottom',
		sideOffset = 4,
		ariaLabel,
		title,
		onValueChange
	}: Props = $props();

	type GroupShape = { heading?: string; items: Item[] };

	// Normalize the three input shapes to a single `{ heading?, items }[]`
	// list so the render path is uniform. `Array.isArray(items[0])` is the
	// runtime discriminator between flat and matrix; an empty `Item[]`
	// collapses to a single empty group either way.
	const groups = $derived.by<GroupShape[]>(() => {
		if (Array.isArray(items)) {
			if (items.length === 0) return [];
			if (Array.isArray(items[0])) {
				return (items as Item[][]).map((g) => ({ items: g }));
			}
			return [{ items: items as Item[] }];
		}
		return Object.entries(items as Record<string, Item[]>).map(([heading, groupItems]) => ({
			heading,
			items: groupItems
		}));
	});

	// Bits-ui's Root and our Value both want a flat list (for keyboard
	// navigation + selected-item lookup). Flatten once here.
	const flatItems = $derived(groups.flatMap((g) => g.items));
</script>

<Root
	{type}
	bind:value={value as never}
	onValueChange={onValueChange as never}
	items={flatItems}
	{disabled}
>
	<Trigger {size} class={cn('w-full', className)} aria-label={ariaLabel} {title}>
		<Value {placeholder} items={flatItems} item={itemSnippet} />
	</Trigger>
	<Content
		{sideOffset}
		{align}
		{side}
		class={cn('max-h-[250px] min-w-(--bits-select-anchor-width)', contentClass)}
	>
		{#each groups as group, gi (gi)}
			{#if gi > 0}
				<Separator />
			{/if}
			<!-- Group wraps items so the list is padded inside the popover. -->
			<Group>
				{#if group.heading}
					<GroupHeading>{group.heading}</GroupHeading>
				{/if}
				{#each group.items as item (item.value)}
					<Item value={item.value} label={item.label} disabled={item.disabled}>
						{#if itemSnippet}
							{@render itemSnippet({ item: item as Item })}
						{:else}
							{item.label}
						{/if}
					</Item>
				{/each}
			</Group>
		{/each}
	</Content>
</Root>
