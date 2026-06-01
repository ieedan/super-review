<script lang="ts">
	import './layout.css';
	import { browser, dev } from '$app/environment';
	import { Agentation, type AnnotationProps } from 'sv-agentation';

	let { children } = $props();

	// Absolute path to this SvelteKit project so Agentation's source links resolve
	// to the real files on disk. Dev-only — never bundled into production.
	const annotationProps: AnnotationProps = {
		workspaceRoot: '/Users/ieedan/Documents/github/super-local-review/apps/docs'
	};
</script>

{@render children()}

{#if browser && dev}
	<Agentation {...annotationProps} />
{/if}
