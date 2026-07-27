<script lang="ts" generics="Item extends { label: string; value: string }">
	import { Select as SelectPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';

	type Props = {
		placeholder: string;
		item?: Snippet<[{ item: Item }]>;
		// bits-ui's `selected` only surfaces `{ value, label }`. When the
		// caller passes the same items they used on `Select.Root`, we look
		// up the full item (including any extra fields like `swatch`) so the
		// snippet can render it consistently in the trigger.
		items?: Item[];
	};

	let { placeholder, item: itemSnippet, items }: Props = $props();

	const itemsByValue = $derived(new Map(items?.map((i) => [i.value, i]) ?? []));

	function resolve(selected: { value: string; label: string }): Item {
		return (itemsByValue.get(selected.value) ?? selected) as Item;
	}
</script>

<SelectPrimitive.Value>
	{#snippet child({ selection, props })}
		{#if selection.type === 'single'}
			<span {...props} data-slot="select-value" class="data-placeholder:text-muted-foreground">
				{#if selection.selected}
					{#if itemSnippet}
						{@render itemSnippet({ item: resolve(selection.selected) })}
					{:else}
						{selection.selected.label}
					{/if}
				{:else}
					{placeholder}
				{/if}
			</span>
		{:else if selection.type === 'multiple'}
			{#if selection.selected?.length}
				<div
					{...props}
					data-slot="select-value"
					class="flex flex-wrap items-center gap-1 overflow-x-auto"
				>
					{#each selection.selected as item (item.value)}
						<span class="rounded-md bg-accent px-1.5 py-0.5">
							{#if itemSnippet}
								{@render itemSnippet({ item: resolve(item) })}
							{:else}
								{item.label}
							{/if}
						</span>
					{/each}
				</div>
			{:else}
				<span {...props} data-slot="select-value" class="data-placeholder:text-muted-foreground">
					{placeholder}
				</span>
			{/if}
		{/if}
	{/snippet}
</SelectPrimitive.Value>
