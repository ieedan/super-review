<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as Popover from './ui/popover';
	import * as Command from './ui/command';
	import OpenCodeModelPicker from './OpenCodeModelPicker.svelte';
	import { cn } from '@super-review/ui/utils';
	import { createCommitMessageModelPicker } from '@super-review/ui/commit-message-model-picker.svelte';
	import type { CommitMessageHarness } from '@super-review/core/types';

	let {
		harness,
		disabled = false,
		class: className,
		align = 'start',
		placeholder = 'Select model',
		onOpenChange
	}: {
		harness: CommitMessageHarness | null;
		disabled?: boolean;
		class?: string;
		align?: 'start' | 'center' | 'end';
		placeholder?: string;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	let open = $state(false);

	// OpenCode lists every authenticated provider at once — hundreds of
	// `provider/model` slugs — so it gets a picker built around that shape.
	const isOpenCode = $derived(harness === 'opencode');

	const picker = createCommitMessageModelPicker({
		harness: () => (isOpenCode ? null : harness),
		open: () => open
	});

	async function selectModel(id: string): Promise<void> {
		await picker.select(id);
		open = false;
	}
</script>

{#if isOpenCode}
	<OpenCodeModelPicker {disabled} class={className} {align} {placeholder} {onOpenChange} />
{:else}
	<Popover.Root bind:open onOpenChange={(next) => onOpenChange?.(next)}>
		<Popover.Trigger
			type="button"
			disabled={disabled || !harness || picker.models.length === 0}
			class={cn(
				'border-input flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),10px)] border bg-transparent px-2.5 text-left text-[0.8rem] outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
				className
			)}
		>
			<span class="min-w-0 flex-1 truncate select-none">
				{picker.selectedLabel || placeholder}
			</span>
			<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
		</Popover.Trigger>
		<Popover.Content
			{align}
			side="bottom"
			sideOffset={4}
			class="w-(--bits-popover-anchor-width) max-w-(--bits-popover-anchor-width) p-0"
			onOpenAutoFocus={(e) => e.preventDefault()}
		>
			<Command.Root>
				<Command.Input placeholder="Search models…" class="h-8 text-xs" />
				<Command.List class="max-h-48">
					<Command.Empty class="py-4 text-xs">No models found</Command.Empty>
					<Command.Group>
						{#each picker.models as model (model.id)}
							<Command.Item
								value={`${model.label} ${model.id}`}
								onSelect={() => void selectModel(model.id)}
								class="text-xs"
							>
								<span class="truncate">{model.label}</span>
							</Command.Item>
						{/each}
					</Command.Group>
				</Command.List>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>
{/if}
