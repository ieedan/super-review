<script lang="ts">
	// Live walkthrough: you drive the real sparkle, the mocked CLI replies on a
	// delay, and the message writes itself into the box exactly as it does
	// against a real harness.
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
		<li>Click the sparkle in the Summary field. That is the whole interaction.</li>
		<li>
			The mocked CLI stays silent for {(timing.startupMs / 1000).toFixed(1)}s — Summary says what is
			happening while the sparkle shimmers.
		</li>
		<li>
			The message then writes itself into the fields: subject into Summary, body into Description.
			The reasoning channel is kept out of the box entirely. The mock reports it in ~60 character
			slabs, which is what the CLIs really do — the box is what paces it back out.
		</li>
		<li>
			Click the shimmering sparkle again to stop. Nothing is written — the box goes back to whatever
			was in it.
		</li>
		<li>
			On success the painted text becomes the real value and focus lands on Commit. Harness, model
			and prompt live in Settings → Agents; with no agent CLI installed there is no sparkle.
		</li>
	</ol>
</div>
