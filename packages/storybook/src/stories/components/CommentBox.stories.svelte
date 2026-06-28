<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import CommentComposerDemo from './CommentComposerDemo.svelte';
	import MarkdownComposer from '@super-review/ui/components/MarkdownComposer.svelte';

	// "Comment box" = the review-comment authoring surface. ReplyComposer is the
	// full controlled composer (slim prompt that expands into a Markdown editor
	// with submit); MarkdownComposer is the bare carta-md editor it wraps.
	const { Story } = defineMeta({
		title: 'Components/Comment Box',
		parameters: { layout: 'padded' }
	});
</script>

<!-- Collapsed and expanded states share one component; click the prompt to expand. -->
<Story name="Reply composer">
	{#snippet template()}
		<CommentComposerDemo />
	{/snippet}
</Story>

<Story name="Replying to a thread">
	{#snippet template()}
		<CommentComposerDemo
			replyingTo="aidan"
			promptPlaceholder="Reply to aidan…"
			submitLabel="Reply"
		/>
	{/snippet}
</Story>

<!-- The raw Markdown editor on its own. -->
<Story name="Markdown editor">
	{#snippet template()}
		<MarkdownEditorDemo />
	{/snippet}
</Story>

{#snippet MarkdownEditorDemo()}
	<div class="w-[520px] max-w-full rounded-lg border border-border bg-card p-3">
		<MarkdownComposer
			value={'## Looks good\n\nOne nit: consider extracting `buttonVariants` into its own file.'}
			placeholder="Write a comment…"
		/>
	</div>
{/snippet}
