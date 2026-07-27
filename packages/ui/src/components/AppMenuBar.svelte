<script lang="ts">
	import { onMount } from 'svelte';
	import type { AppMenuBarItem } from '@super-review/core/types';
	import iconUrl from '../assets/super-review-icon.png';

	// Windows-only application menu strip that shares a row with the native
	// titleBarOverlay window controls (GitHub Desktop style). Top-level labels
	// are drawn here; clicking pops the real native submenu via IPC. macOS keeps
	// the system menu bar; this component is not mounted there.

	// Seeded immediately so the bar never paints empty while IPC resolves (or if
	// localization fetch fails). Ids match the main-process menu template.
	const DEFAULT_ITEMS: AppMenuBarItem[] = [
		{ id: 'file', label: 'File' },
		{ id: 'edit', label: 'Edit' },
		{ id: 'view', label: 'View' },
		{ id: 'repository', label: 'Repository' },
		{ id: 'branch', label: 'Branch' },
		{ id: 'window', label: 'Window' },
		{ id: 'help', label: 'Help' }
	];

	let items = $state<AppMenuBarItem[]>(DEFAULT_ITEMS);
	let openId = $state<string | null>(null);
	// While a submenu is open, hovering another label switches to it (Windows
	// menu-bar convention). Cleared when the popup closes.
	let armed = $state(false);

	onMount(() => {
		void window.api.menu
			.getAppMenuBarItems()
			.then((list) => {
				if (list && list.length > 0) items = list;
			})
			.catch(() => {
				/* keep DEFAULT_ITEMS */
			});
	});

	async function openMenu(item: AppMenuBarItem, el: HTMLElement): Promise<void> {
		const rect = el.getBoundingClientRect();
		openId = item.id;
		armed = true;
		try {
			await window.api.menu.popupAppMenu({
				id: item.id,
				x: rect.left,
				y: rect.bottom
			});
		} finally {
			// Only clear if this popup is still the active one (a hover-switch may
			// have opened a different menu while we were awaiting).
			if (openId === item.id) {
				openId = null;
				armed = false;
			}
		}
	}

	function onButtonClick(item: AppMenuBarItem, e: MouseEvent): void {
		const el = e.currentTarget as HTMLElement;
		if (openId === item.id) return;
		void openMenu(item, el);
	}

	function onButtonEnter(item: AppMenuBarItem, e: MouseEvent): void {
		if (!armed || openId === item.id) return;
		const el = e.currentTarget as HTMLElement;
		void openMenu(item, el);
	}
</script>

<!-- Height must match MENU_BAR_HEIGHT / titleBarOverlay.height in main.
     Styled like TopBar (bg-card/40) so the strip matches the app chrome; the
     overlay color is transparent so native buttons sit on this same surface.
     Pad with titlebar-area env vars (not width:) so a bad/zero width var can't
     collapse the labels to nothing. -->
<div
	class="flex h-[30px] w-full shrink-0 items-center gap-0.5 border-b border-border bg-card/40 backdrop-blur"
	style="-webkit-app-region: drag; padding-left: env(titlebar-area-x, 0px); padding-right: calc(100% - env(titlebar-area-width, 100%) - env(titlebar-area-x, 0px));"
	role="menubar"
>
	<img src={iconUrl} alt="" class="ml-2 mr-1 size-4 shrink-0 rounded-sm" aria-hidden="true" />
	<nav class="flex h-full items-stretch" style="-webkit-app-region: no-drag">
		{#each items as item (item.id)}
			<button
				type="button"
				role="menuitem"
				aria-haspopup="true"
				aria-expanded={openId === item.id}
				class={[
					'px-2.5 text-[13px] leading-none text-foreground/90 hover:bg-accent',
					openId === item.id && 'bg-accent'
				]}
				onclick={(e) => onButtonClick(item, e)}
				onmouseenter={(e) => onButtonEnter(item, e)}
			>
				{item.label}
			</button>
		{/each}
	</nav>
	<!-- Remaining title-bar area stays draggable for moving the window. -->
	<div class="min-w-0 flex-1"></div>
</div>
