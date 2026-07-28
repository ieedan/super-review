<script lang="ts">
	import { untrack } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as Popover from './ui/popover';
	import * as Command from './ui/command';
	import { actions, app } from '@super-review/ui/store.svelte';
	import { cn } from '@super-review/ui/utils';
	import { formatClaudeModelLabel } from '@super-review/core/model-label';
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
	let modelsRequestId = 0;

	// Read straight from the store's cache: it's prefetched on launch (and backed
	// by an on-disk cache in main), so the list is already there when the picker
	// opens. loadModels only refreshes it in the background.
	const modelItems = $derived(
		(harness ? (app.commitMessageModels[harness] ?? []) : []).map((m) => ({
			value: m.id,
			label: m.label
		}))
	);

	const selectedModel = $derived.by(() => {
		if (!harness) return '';
		return app.prefs?.commitMessageModels?.[harness] ?? modelItems[0]?.value ?? '';
	});

	// A model pinned before the list changed shape (or picked under another
	// harness) won't match an item, so name it rather than showing the raw id.
	const selectedModelLabel = $derived(
		modelItems.find((m) => m.value === selectedModel)?.label ??
			formatClaudeModelLabel(selectedModel) ??
			selectedModel
	);

	// Refresh in the background. The list the user sees comes from the store cache,
	// so this never gates a paint; it only fills a never-listed harness or picks up
	// a newer list. Main serves from disk and revalidates stale entries itself.
	async function loadModels(target: CommitMessageHarness): Promise<void> {
		const requestId = ++modelsRequestId;
		const models = await actions.listCommitMessageModels(target);
		if (requestId !== modelsRequestId) return;
		const saved = app.prefs?.commitMessageModels?.[target];
		if (!saved && models[0]) {
			await actions.setCommitMessageModel(target, models[0].id);
		}
	}

	$effect(() => {
		const target = harness;
		const isOpen = open;
		if (!target) return;
		// Opening always revalidates; otherwise only fetch a harness the store has
		// never listed, so mounting a row per harness doesn't re-probe every CLI.
		if (!isOpen && app.commitMessageModels[target]) return;
		// untrack: loadModels writes the store's model cache, which this effect
		// reads above — untracked so it can't re-trigger itself.
		untrack(() => void loadModels(target));
	});

	async function selectModel(value: string): Promise<void> {
		if (!value || !harness) return;
		await actions.setCommitMessageModel(harness, value);
		open = false;
	}

	function handleOpenChange(next: boolean): void {
		onOpenChange?.(next);
	}
</script>

<Popover.Root bind:open onOpenChange={handleOpenChange}>
	<Popover.Trigger
		type="button"
		disabled={disabled || !harness || modelItems.length === 0}
		class={cn(
			'border-input flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),10px)] border bg-transparent px-2.5 text-left text-[0.8rem] outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
			className
		)}
	>
		<span class="min-w-0 flex-1 truncate select-none">
			{selectedModelLabel || placeholder}
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
					{#each modelItems as model (model.value)}
						<Command.Item
							value={`${model.label} ${model.value}`}
							onSelect={() => void selectModel(model.value)}
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
