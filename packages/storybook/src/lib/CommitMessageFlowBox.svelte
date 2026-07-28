<script lang="ts">
	// The commit box as far as this flow is concerned: the Summary field with the
	// sparkle trigger in its corner, and the Description the generated body lands
	// in. Mirrors CommitBox's markup for these two controls so the popover sits
	// where it really does, without dragging in accounts, drafts, or push state.
	import { Input } from '@super-review/ui/components/ui/input';
	import { Textarea } from '@super-review/ui/components/ui/textarea';
	import GenerateCommitMessageButton from '@super-review/ui/components/GenerateCommitMessageButton.svelte';

	let {
		open = $bindable(false),
		subject = $bindable(''),
		body = $bindable('')
	}: { open?: boolean; subject?: string; body?: string } = $props();
</script>

<div class="flex w-[420px] flex-col gap-2 rounded-lg border border-border bg-card p-3">
	<div class="relative min-w-0 flex-1">
		<Input
			type="text"
			bind:value={subject}
			placeholder="Summary (required)"
			class="h-7 min-w-0 pr-8 text-xs"
		/>
		<GenerateCommitMessageButton
			bind:open
			onGenerated={(result) => {
				subject = result.subject;
				body = result.body;
			}}
		/>
	</div>
	<Textarea bind:value={body} placeholder="Description" rows={4} class="text-xs" />
</div>
