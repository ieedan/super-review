<script lang="ts">
	// Reusable settings-dialog shell: a titled dialog with a left tab nav and a
	// scrollable content pane, plus an optional footer. Shared by the app Settings
	// dialog and the per-repo Repository Settings dialog so the layout lives in one
	// place. The owner supplies the tabs, the active tab (bindable), and snippets
	// for the content (rendered with the active tab id) and footer.
	import type { Snippet } from 'svelte';
	import type { LucideIcon } from '@lucide/svelte';
	import Search from '@lucide/svelte/icons/search';
	import * as Dialog from './ui/dialog';
	import { Input } from './ui/input';
	import { cn } from '@super-review/ui/utils';

	// `LucideIcon` (a `Component<LucideProps>`) is the shared type every lucide
	// icon is assignable to. Imported type-only so it's erased at build and never
	// pulls the icon barrel into the bundle.
	type Tab = { id: string; label: string; icon: LucideIcon };

	let {
		open = $bindable(false),
		title,
		tabs,
		activeTab = $bindable(),
		onClose,
		content,
		footer,
		enableSearch = false,
		searchQuery = $bindable(''),
		searchResults
	}: {
		open: boolean;
		title: string;
		tabs: Tab[];
		activeTab: string;
		onClose?: () => void;
		content: Snippet<[string]>;
		footer?: Snippet;
		enableSearch?: boolean;
		searchQuery?: string;
		searchResults?: Snippet;
	} = $props();

	const searching = $derived(enableSearch && searchQuery.trim().length > 0);

	$effect(() => {
		if (!open) searchQuery = '';
	});
</script>

<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (!o) onClose?.();
	}}
>
	<Dialog.Content
		class="w-[720px] !max-w-[calc(100%-2rem)] !gap-0 overflow-hidden !p-0"
		showCloseButton={true}
	>
		<Dialog.Header class="space-y-3 border-b border-border px-4 py-3">
			<Dialog.Title class="text-base">{title}</Dialog.Title>
			{#if enableSearch}
				<div class="relative">
					<Search
						class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						bind:value={searchQuery}
						placeholder="Search settings…"
						class="h-8 pl-8 text-sm"
						aria-label="Search settings"
					/>
				</div>
			{/if}
		</Dialog.Header>

		<div class="flex h-[480px] min-h-0">
			<!-- Left nav -->
			<nav
				class={cn(
					'w-48 shrink-0 border-r border-border bg-card/30 p-2',
					searching && 'opacity-60'
				)}
				aria-hidden={searching}
			>
				{#each tabs as tab (tab.id)}
					{@const Icon = tab.icon}
					<button
						type="button"
						class={cn(
							'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
							activeTab === tab.id
								? 'bg-muted text-foreground'
								: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
						)}
						onclick={() => (activeTab = tab.id)}
					>
						<Icon class="size-4" />
						{tab.label}
					</button>
				{/each}
			</nav>

			<!-- Content panel -->
			<div class="min-w-0 flex-1 overflow-y-auto p-5">
				{#if searching && searchResults}
					{@render searchResults()}
				{:else}
					{@render content(activeTab)}
				{/if}
			</div>
		</div>

		{#if footer}
			<footer
				class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3"
			>
				{@render footer()}
			</footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
