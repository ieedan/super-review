<script lang="ts">
	// A file's icon: the changeset butterfly for `.changeset/*.md` files, otherwise
	// the language icon for its extension. `class` controls sizing (the butterfly
	// keeps its aspect ratio inside the given box).
	import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import { languageIconForPath } from './file-icons';
	import { isChangesetPath } from './changeset';

	let { path, class: className = 'size-3.5' }: { path: string; class?: string } = $props();
</script>

{#if isChangesetPath(path)}
	<ChangesetLogo class={className} />
{:else}
	<Icon icon={languageIconForPath(path)} class={className} />
{/if}
