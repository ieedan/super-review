<script lang="ts">
	import { onMount } from 'svelte';
	import type { AppMenuBarItem } from '@super-review/core/types';
	import iconUrl from '../assets/super-review-icon.png';

	// Windows-only application menu strip that shares a row with the native
	// titleBarOverlay window controls (GitHub Desktop style). Top-level labels
	// are drawn here; clicking pops the real native submenu via IPC. macOS keeps
	// the system menu bar; this component is not mounted there.

	let items = $state<AppMenuBarItem[]>([]);
	let openId = $state<string | null>(null);
	// While a submenu is open, hovering another label switches to it (Windows
	// menu-bar convention). Cleared when the popup closes.
	let armed = $state(false);

	onMount(() => {
		void window.api.menu.getAppMenuBarItems().then((list) => {
			items = list ?? [];
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

<!-- Height must match MENU_BAR_HEIGHT / titleBarOverlay.height in main. -->
<div
	class="flex h-[30px] w-full shrink-0 items-stretch border-b border-border bg-background"
	style="-webkit-app-region: drag"
	role="menubar"
>
	<!-- Constrain interactive content to the Window Controls Overlay safe area
	     so labels never sit under the native min/max/close buttons. -->
	<div
		class="flex h-full min-w-0 items-center gap-0.5"
		style="margin-left: env(titlebar-area-x, 0px); width: env(titlebar-area-width, 100%);"
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
</div>
