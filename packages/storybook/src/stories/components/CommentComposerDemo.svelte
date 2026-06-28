<script lang="ts">
	import ReplyComposer from '@super-review/ui/components/ReplyComposer.svelte';

	// Wires ReplyComposer's *controlled* expansion to local state so the story is
	// fully interactive: click the slim prompt to expand into the editor, type,
	// and submit. `onsubmit` just logs and resolves true (success), since there's
	// no backend in Storybook.
	let {
		replyingTo,
		promptPlaceholder = 'Reply…',
		editorPlaceholder = 'Leave a review comment…',
		submitLabel = 'Comment'
	}: {
		replyingTo?: string;
		promptPlaceholder?: string;
		editorPlaceholder?: string;
		submitLabel?: string;
	} = $props();

	let expanded = $state(false);

	async function onsubmit(body: string): Promise<boolean> {
		console.log('[CommentComposer] submit:', body);
		expanded = false;
		return true;
	}
</script>

<div class="w-[520px] max-w-full rounded-lg border border-border bg-card p-3">
	<ReplyComposer
		{expanded}
		onexpand={() => (expanded = true)}
		oncollapse={() => (expanded = false)}
		{onsubmit}
		{replyingTo}
		{promptPlaceholder}
		{editorPlaceholder}
		{submitLabel}
	/>
</div>
