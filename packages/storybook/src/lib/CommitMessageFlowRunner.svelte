<script lang="ts">
	// Live walkthrough: you drive the real trigger and popover, the mocked CLI
	// replies on a delay, and the streamed text lands in the box exactly as it
	// does against a real harness.
	import CommitMessageFlowBox from './CommitMessageFlowBox.svelte';
	import { setMockScript, type MockResponse, type MockTiming } from './commit-message-flow';

	let { response, timing }: { response: MockResponse; timing: MockTiming } = $props();

	// Mirrors HOVER_OPEN_DELAY_MS in the component, for the copy below.
	const HOVER_PEEK_MS = 400;

	// Runs before any click can start a generation, and again whenever the
	// Controls panel edits the mocked reply.
	$effect(() => setMockScript(response, timing));
</script>

<div class="flex w-[420px] flex-col gap-3">
	<CommitMessageFlowBox />

	<ol
		class="flex list-inside list-decimal flex-col gap-1 rounded-lg border border-border bg-card p-3 text-[11px] leading-snug text-muted-foreground"
	>
		<li>
			Click the sparkle in the Summary field. That is the whole interaction — it starts a run.
		</li>
		<li>
			Keep the pointer on the shimmering sparkle for {(HOVER_PEEK_MS / 1000).toFixed(1)}s and this
			panel opens to show what the agent is doing. Clicking it again opens the panel straight away.
		</li>
		<li>
			The mocked CLI stays silent for {(timing.startupMs / 1000).toFixed(1)}s — the shimmering
			"Thinking…" state — then streams reasoning, then the message.
		</li>
		<li>
			Cancel at any point (that closes the panel too), or let it finish: Summary and Description
			fill in and focus lands on Commit.
		</li>
		<li>
			Harness, model and prompt are not here — they live in Settings → Agents. With no agent CLI
			installed the sparkle is not rendered at all.
		</li>
	</ol>
</div>
