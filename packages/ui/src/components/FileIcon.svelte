<script lang="ts">
	// A file's icon: a user-registered custom icon when one matches, the changeset
	// butterfly for `.changeset/*.md` files, otherwise the language icon for its
	// extension. `class` controls sizing (the butterfly keeps its aspect ratio
	// inside the given box).
	import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import {
		customIconSourceForPath,
		languageIconForPath,
		resolveIconSrc
	} from '@super-review/ui/file-icons';
	import { isChangesetPath } from '@super-review/ui/changeset';
	import { app } from '@super-review/ui/store.svelte';

	let { path, class: className = 'size-3.5' }: { path: string; class?: string } = $props();

	// The custom-icon source configured for this path, if any. Computed synchronously;
	// the actual <img> src may need an async read (local paths), tracked below.
	const customSource = $derived(customIconSourceForPath(path, app.customFileIcons));

	let customSrc = $state<string | null>(null);
	$effect(() => {
		const source = customSource;
		customSrc = null;
		if (!source) return;
		let cancelled = false;
		void resolveIconSrc(source).then((src) => {
			if (!cancelled) customSrc = src;
		});
		return () => {
			cancelled = true;
		};
	});
</script>

{#if customSource && customSrc}
	<img src={customSrc} alt="" class="{className} object-contain" />
{:else if isChangesetPath(path)}
	<ChangesetLogo class={className} />
{:else}
	<Icon icon={languageIconForPath(path)} class={className} />
{/if}
