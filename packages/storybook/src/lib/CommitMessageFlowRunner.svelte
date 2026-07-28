<script lang="ts">
	// Live walkthrough: you drive the real trigger and popover, the mocked CLI
	// replies on a delay, and the streamed text lands in the box exactly as it
	// does against a real harness.
	import CommitMessageFlowBox from './CommitMessageFlowBox.svelte';
	import { setMockScript, type MockResponse, type MockTiming } from './commit-message-flow';

	let { response, timing }: { response: MockResponse; timing: MockTiming } = $props();

	// Runs before any click can start a generation, and again whenever the
	// Controls panel edits the mocked reply.
	$effect(() => setMockScript(response, timing));
</script>

<div class="flex w-[420px] flex-col gap-3">
	<CommitMessageFlowBox />

	<ol
		class="flex list-inside list-decimal flex-col gap-1 rounded-lg border border-border bg-card p-3 text-[11px] leading-snug text-muted-foreground"
	>
		<li>Hover or click the sparkle in the Summary field to open the popover.</li>
		<li>Pick a harness with the chevron, or a model below it. Edit the prompt if you like.</li>
		<li>
			Hit <span class="text-foreground">Generate with…</span> (or Enter in the prompt, or shift-click
			the sparkle to skip the popover).
		</li>
		<li>
			The mocked CLI stays silent for {(timing.startupMs / 1000).toFixed(1)}s — that is the
			shimmering "Thinking…" state — then streams reasoning, then the message.
		</li>
		<li>Cancel at any point, or let it finish and watch it fill Summary and Description.</li>
	</ol>
</div>
