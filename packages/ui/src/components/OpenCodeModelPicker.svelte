<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import * as Popover from './ui/popover';
	import * as Command from './ui/command';
	import { cn } from '@super-review/ui/utils';
	import { createCommitMessageModelPicker } from '@super-review/ui/commit-message-model-picker.svelte';
	import { groupOpenCodeModels, splitOpenCodeSlug } from '@super-review/ui/opencode-model-groups';

	let {
		disabled = false,
		class: className,
		align = 'start',
		placeholder = 'Select model',
		onOpenChange
	}: {
		disabled?: boolean;
		class?: string;
		align?: 'start' | 'center' | 'end';
		placeholder?: string;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	let open = $state(false);

	const picker = createCommitMessageModelPicker({
		harness: () => 'opencode',
		open: () => open
	});

	// OpenCode aggregates every authenticated provider into one flat list, which
	// runs to hundreds of models. Grouping by provider is what makes it readable.
	const groups = $derived(groupOpenCodeModels(picker.models));
	const selected = $derived(splitOpenCodeSlug(picker.selected));

	async function selectModel(id: string): Promise<void> {
		await picker.select(id);
		open = false;
	}
</script>

<Popover.Root bind:open onOpenChange={(next) => onOpenChange?.(next)}>
	<Popover.Trigger
		type="button"
		disabled={disabled || picker.models.length === 0}
		class={cn(
			'border-input flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),10px)] border bg-transparent px-2.5 text-left text-[0.8rem] outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
			className
		)}
	>
		<!-- Only the model name: slugs are long enough that a provider prefix would
		     eat the whole trigger, and the popover groups by provider anyway. The
		     full slug is on the tooltip. -->
		<span class="min-w-0 flex-1 truncate select-none" title={selected.id || undefined}>
			{selected.name || placeholder}
		</span>
		<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
	</Popover.Trigger>
	<Popover.Content
		{align}
		side="bottom"
		sideOffset={4}
		class="w-[min(22rem,calc(100vw-2rem))] min-w-(--bits-popover-anchor-width) p-0"
		onOpenAutoFocus={(e) => e.preventDefault()}
	>
		<Command.Root>
			<Command.Input placeholder="Search models…" class="h-8 text-xs" />
			<Command.List class="max-h-72">
				<Command.Empty class="py-4 text-xs">No models found</Command.Empty>
				{#each groups as group (group.provider)}
					<Command.Group
						heading={group.provider || 'Other'}
						class="[&_[data-command-group-heading]]:text-[0.65rem] [&_[data-command-group-heading]]:font-semibold [&_[data-command-group-heading]]:tracking-wider [&_[data-command-group-heading]]:uppercase"
					>
						{#each group.models as model (model.id)}
							<Command.Item
								value={model.id}
								onSelect={() => void selectModel(model.id)}
								class="gap-2 text-xs [content-visibility:auto] [contain-intrinsic-size:auto_28px]"
							>
								<span class="min-w-0 flex-1 truncate">{model.name}</span>
								{#if model.id === picker.selected}
									<Check class="size-3.5 shrink-0 text-muted-foreground" />
								{/if}
							</Command.Item>
						{/each}
					</Command.Group>
				{/each}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
