<script lang="ts">
	// Headless glue between the native macOS "Branch" menu (built in the main
	// process) and the renderer. Renders nothing: it (1) pushes the current
	// enablement/label state up so the menu greys out inapplicable items, and
	// (2) runs the matching store flow when a menu item is chosen (including
	// Windows accelerators, which still ride the installed application menu).
	// Mounted once at the app root so it tracks state even when no repo is open.
	import { onMount } from 'svelte';
	import { branchMenuState, handleBranchMenuAction } from '@super-review/ui/app-menu-actions';

	// Keep the native Branch menu's enabled state + dynamic labels in sync.
	// Deduped so unrelated reactive churn (e.g. file-list updates) doesn't rebuild
	// the OS menu unless something it shows actually changed.
	let lastSent = '';
	$effect(() => {
		const state = branchMenuState();
		const serialized = JSON.stringify(state);
		if (serialized === lastSent) return;
		lastSent = serialized;
		window.api.menu.setBranchState(state);
	});

	onMount(() => window.api.events.onBranchMenuAction(handleBranchMenuAction));
</script>
