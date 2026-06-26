<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from './ui/button';

	// Thread-level action bar shared by the PR (CommentAnnotation) and local
	// (LocalCommentAnnotation) comment threads, so both render the same controls in
	// the same place — below the whole conversation. Holds "Copy thread" (always)
	// and the Resolve/Unresolve toggle (when the thread is resolvable).
	interface Props {
		// Current resolved state, for the toggle's label/icon.
		resolved: boolean;
		// Copy the whole thread as markdown.
		onCopyThread: () => void;
		// Whether to show the resolve toggle. PR threads need a GraphQL thread id to
		// resolve, so they pass false until one exists; local threads are always
		// resolvable.
		canResolve?: boolean;
		onToggleResolved?: () => void;
	}
	let { resolved, onCopyThread, canResolve = true, onToggleResolved }: Props = $props();

	// Brief checkmark on the copy button after a copy.
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;
	function copy(): void {
		onCopyThread();
		copied = true;
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="thread-actions">
	<Button variant="outline" size="sm" onclick={copy}>
		{#if copied}
			<Check class="size-3.5" style="color: var(--color-success);" />
		{:else}
			<Copy class="size-3.5" />
		{/if}
		Copy thread
	</Button>
	{#if canResolve && onToggleResolved}
		<Button variant="outline" size="sm" onclick={onToggleResolved}>
			{#if !resolved}
				<Check class="size-3.5" />
			{/if}
			{resolved ? 'Unresolve' : 'Resolve'}
		</Button>
	{/if}
</div>

<style>
	/* Sits below the last comment, separated by a rule, so the controls read as
	   thread-level actions rather than part of that comment. */
	.thread-actions {
		display: flex;
		gap: 6px;
		margin-top: 6px;
		padding-top: 6px;
		border-top: 1px solid var(--color-border);
	}
</style>
