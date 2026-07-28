<script lang="ts">
	// Headless glue between the native "Repository" menu (built in the main
	// process) and the renderer — mirrors BranchMenu. Renders nothing: it pushes
	// the current enablement/labels up so the native menu reflects the active repo,
	// and runs the matching store flow when an item is chosen (including Windows
	// accelerators). Mounted once at the app root.
	import { onMount } from 'svelte';
	import {
		handleRepositoryMenuAction,
		repositoryMenuState
	} from '@super-review/ui/app-menu-actions';

	// Keep the native Repository menu's enabled state + dynamic labels in sync,
	// deduped so unrelated reactive churn doesn't rebuild the OS menu.
	let lastSent = '';
	$effect(() => {
		const state = repositoryMenuState();
		const serialized = JSON.stringify(state);
		if (serialized === lastSent) return;
		lastSent = serialized;
		window.api.menu.setRepositoryState(state);
	});

	onMount(() => window.api.events.onRepositoryMenuAction(handleRepositoryMenuAction));
</script>
