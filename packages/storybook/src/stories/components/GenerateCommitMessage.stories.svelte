<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import StoreScope from '../../lib/StoreScope.svelte';
	import CommitMessageFlowRunner from '../../lib/CommitMessageFlowRunner.svelte';
	import CommitMessageStepper from '../../lib/CommitMessageStepper.svelte';
	import { seedStore } from '../../lib/store-harness';
	import {
		DEFAULT_RESPONSE,
		DEFAULT_TIMING,
		OPENCODE_MODELS,
		installCommitMessageMock
	} from '../../lib/commit-message-flow';
	import type { ChangedFile, CommitMessageHarness } from '@super-review/core/types';

	// Stands in for the main process for the whole flow: harness detection, model
	// lists, and a generate() that streams a scripted reply. Installed at module
	// load so it is in place before the store's one-time progress subscription.
	installCommitMessageMock();

	const FILES: ChangedFile[] = [
		{
			path: 'apps/desktop/src/main/commit-message/stream.ts',
			status: 'added',
			additions: 96,
			deletions: 0
		},
		{
			path: 'apps/desktop/src/main/commit-message/adapters/claude.ts',
			status: 'modified',
			additions: 41,
			deletions: 18
		}
	] as ChangedFile[];

	// Everything generateCommitMessage() reads before it reaches the mocked CLI:
	// a repo, checked files, an installed harness, and a cached model list.
	function seed(harness: CommitMessageHarness) {
		return () =>
			seedStore({
				activeRepo: { id: 'repo-1', name: 'super-review', path: '/tmp/super-review' },
				currentBranch: 'feat/harness-commit-messages',
				changedFiles: FILES,
				commitMessageGenerating: false,
				commitMessageReasoning: '',
				commitMessageAnswer: '',
				commitMessageHarnesses: {
					cursor: true,
					'claude-code': true,
					codex: true,
					copilot: true,
					opencode: true
				},
				commitMessageModels: {
					'claude-code': [
						{ id: 'haiku', label: 'Haiku' },
						{ id: 'sonnet', label: 'Sonnet' },
						{ id: 'opus', label: 'Opus' }
					],
					cursor: [
						{ id: 'composer-2.5-fast', label: 'Composer 2.5 Fast' },
						{ id: 'composer-2.5', label: 'Composer 2.5' }
					],
					codex: [
						{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
						{ id: 'gpt-5.3-codex', label: 'Codex 5.3' }
					],
					copilot: [
						{ id: 'claude-haiku-4.5', label: 'Haiku 4.5' },
						{ id: 'gpt-5-mini', label: 'GPT-5 mini' }
					],
					opencode: OPENCODE_MODELS
				},
				prefs: { commitMessageHarness: harness }
			});
	}

	// Nothing installed: effectiveCommitMessageHarness() is null and the sparkle is
	// not rendered at all.
	function seedNoAgents() {
		return () =>
			seedStore({
				activeRepo: { id: 'repo-1', name: 'super-review', path: '/tmp/super-review' },
				currentBranch: 'feat/harness-commit-messages',
				changedFiles: FILES,
				commitMessageGenerating: false,
				commitMessageReasoning: '',
				commitMessageAnswer: '',
				commitMessageHarnesses: {
					cursor: false,
					'claude-code': false,
					codex: false,
					copilot: false,
					opencode: false
				},
				commitMessageModels: {},
				prefs: {}
			});
	}

	const { Story } = defineMeta({
		title: 'Components/Generate Commit Message',
		parameters: { layout: 'centered' },
		args: {
			harness: 'claude-code' as CommitMessageHarness,
			reasoning: DEFAULT_RESPONSE.reasoning,
			subject: DEFAULT_RESPONSE.subject,
			body: DEFAULT_RESPONSE.body,
			startupMs: DEFAULT_TIMING.startupMs,
			chunkMs: DEFAULT_TIMING.chunkMs
		},
		argTypes: {
			harness: {
				name: 'Harness',
				description: 'Which CLI the run uses (its default model comes from settings).',
				control: 'select',
				options: ['claude-code', 'cursor', 'codex', 'copilot', 'opencode']
			},
			reasoning: {
				name: 'Model reasoning',
				description:
					'Streamed before the answer and deliberately never shown in the box. Empty to skip straight to the message.',
				control: 'text'
			},
			subject: { name: 'Model subject', control: 'text' },
			body: { name: 'Model body', control: 'text' },
			startupMs: {
				name: 'Silence before first token (ms)',
				description: 'How long the waiting state is on screen.',
				control: { type: 'range', min: 0, max: 15000, step: 250 }
			},
			chunkMs: {
				name: 'Delay per streamed chunk (ms)',
				control: { type: 'range', min: 0, max: 300, step: 5 }
			}
		}
	});
</script>

<!-- Drive it yourself: click the sparkle and watch the mocked CLI write the
     message into the box. Stopping it works too. -->
<Story name="Run The Flow">
	{#snippet template(args)}
		<StoreScope frame={false} setup={seed(args.harness)}>
			<CommitMessageFlowRunner
				response={{ reasoning: args.reasoning, subject: args.subject, body: args.body }}
				timing={{ startupMs: args.startupMs, chunkMs: args.chunkMs }}
			/>
		</StoreScope>
	{/snippet}
</Story>

<!-- The same flow frozen into steps: forwards, backwards, or jump to any state. -->
<Story name="Step Through">
	{#snippet template(args)}
		<StoreScope frame={false} setup={seed(args.harness)}>
			<CommitMessageStepper
				response={{ reasoning: args.reasoning, subject: args.subject, body: args.body }}
			/>
		</StoreScope>
	{/snippet}
</Story>

<!-- No agent CLI on the machine: the Summary field has no sparkle in it, and
     there is nothing to configure until one is installed. -->
<Story name="No Agents Installed">
	{#snippet template()}
		<StoreScope frame={false} setup={seedNoAgents()}>
			<CommitMessageFlowRunner response={DEFAULT_RESPONSE} timing={DEFAULT_TIMING} />
		</StoreScope>
	{/snippet}
</Story>
