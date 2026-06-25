<script lang="ts">
	// The real desktop FileList sidebar, booted against the mock store. Interactive:
	// toggle list/tree, mark files seen (green check), collapse folders, search.
	import { bootDemo } from '$lib/demo/boot';
	import FileList from '@super-review/ui/components/FileList.svelte';

	let { class: className = 'h-[440px]' }: { class?: string } = $props();

	bootDemo();
</script>

<!-- --sidebar-width: FileList sizes its root to this var (set by the app shell).
     Standalone, fill the card. -->
<div
	class="demo-filelist {className} overflow-hidden rounded-xl border border-border bg-background"
	style="--sidebar-width: 100%;"
>
	<FileList />
</div>

<style>
	/* Trim chrome that has no meaning in a standalone demo: the whole top header
	   row (the Unstaged/Branch tabs, seen/total + diffstat totals, and the sidebar
	   collapse trigger). The search box + file list below it stay. */
	.demo-filelist :global([data-slot='sidebar-header'] > div:first-child) {
		display: none;
	}
	/* Keep scrolling inside the demo from chaining to the page, and never smooth-scroll
	   (the page sets scroll-behavior: smooth on html). */
	.demo-filelist :global(*) {
		overscroll-behavior: contain;
		scroll-behavior: auto;
	}
</style>
