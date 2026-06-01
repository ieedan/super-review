<script lang="ts">
	// Reusable settings-dialog shell: a titled dialog with a left tab nav and a
	// scrollable content pane, plus an optional footer. Shared by the app Settings
	// dialog and the per-repo Repository Settings dialog so the layout lives in one
	// place. The owner supplies the tabs, the active tab (bindable), and snippets
	// for the content (rendered with the active tab id) and footer.
	import type { Snippet } from 'svelte';
	import { Icon } from 'lucide-svelte';
	import * as Dialog from './ui/dialog';
	import { cn } from '$lib/utils';

	// lucide-svelte icons are SvelteComponentTyped classes; `typeof Icon` (the base
	// icon class) is the shared constructor type every icon is assignable to.
	type Tab = { id: string; label: string; icon: typeof Icon };

	let {
		open = $bindable(false),
		title,
		tabs,
		activeTab = $bindable(),
		onClose,
		content,
		footer
	}: {
		open: boolean;
		title: string;
		tabs: Tab[];
		activeTab: string;
		onClose?: () => void;
		content: Snippet<[string]>;
		footer?: Snippet;
	} = $props();
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
		<Dialog.Header class="border-b border-border px-4 py-3">
			<Dialog.Title class="text-base">{title}</Dialog.Title>
		</Dialog.Header>

		<div class="flex h-[480px] min-h-0">
			<!-- Left nav -->
			<nav class="w-48 shrink-0 border-r border-border bg-card/30 p-2">
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
				{@render content(activeTab)}
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
