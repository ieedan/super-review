<script lang="ts">
	// Reusable settings-dialog shell: a titled dialog with a left tab nav and a
	// scrollable content pane, plus an optional footer. Shared by the app Settings
	// dialog and the per-repo Repository Settings dialog so the layout lives in one
	// place. The owner supplies the tabs, the active tab (bindable), and snippets
	// for the content (rendered with the active tab id) and footer.
	import type { Snippet } from 'svelte';
	import type { LucideIcon } from '@lucide/svelte';
	import * as Dialog from './ui/dialog';
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
		onSelectTab,
		search,
		content,
		footer
	}: {
		open: boolean;
		title: string;
		tabs: Tab[];
		activeTab: string;
		onClose?: () => void;
		// Called when a tab is picked from the nav, after activeTab updates. Lets
		// the owner react (e.g. clear an in-progress search) without watching the
		// binding.
		onSelectTab?: (id: string) => void;
		// Optional control rendered at the top of the left nav, above the tabs.
		// The app Settings dialog uses it for a search box; other owners omit it.
		search?: Snippet;
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
			<nav class="flex w-48 shrink-0 flex-col border-r border-border bg-card/30 p-2">
				{#if search}
					<div class="mb-2">
						{@render search()}
					</div>
				{/if}
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
						onclick={() => {
							activeTab = tab.id;
							onSelectTab?.(tab.id);
						}}
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
