<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DiffHunkSnippet from '@super-review/ui/components/DiffHunkSnippet.svelte';

	// DiffHunkSnippet renders a single stored unified-diff hunk (the `diff_hunk`
	// GitHub attaches to a review comment) through Pierre's diff renderer. It's the
	// compact, prop-driven cousin of the full DiffView.
	const HUNK = [
		'@@ -10,7 +10,8 @@ export function buttonVariants() {',
		' 	base: "inline-flex items-center justify-center",',
		' 	variants: {',
		'-		variant: { default: "bg-primary" },',
		'+		variant: { default: "bg-primary", ghost: "hover:bg-muted" },',
		'+		// added a ghost variant',
		' 		size: { default: "h-8 px-2.5" }',
		' 	}',
		' });'
	].join('\n');

	function bigHunk(lines: number): string {
		const out = ['@@ -1,' + lines + ' +1,' + (lines + lines / 4) + ' @@'];
		for (let i = 0; i < lines; i++) {
			if (i % 4 === 0) {
				out.push(`-const removed_${i} = ${i};`);
				out.push(`+const added_${i} = ${i} + 1;`);
			} else {
				out.push(` const kept_${i} = ${i};`);
			}
		}
		return out.join('\n');
	}

	const { Story } = defineMeta({
		title: 'Components/Diff Hunk Snippet',
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="max-w-2xl">
			<DiffHunkSnippet hunk={HUNK} path="src/components/ui/button/button.svelte" />
		</div>
	{/snippet}
</Story>

<!-- Performance: a single very large hunk (hundreds of changed lines) to confirm
     the per-comment diff renderer handles big stored hunks without stutter. -->
<Story name="Performance (large hunk)">
	{#snippet template()}
		<div class="max-w-2xl">
			<DiffHunkSnippet hunk={bigHunk(400)} path="packages/core/src/store.ts" />
		</div>
	{/snippet}
</Story>
